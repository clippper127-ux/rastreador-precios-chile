import {
  AdapterError,
  extractJsonLd,
  extractNextData,
  findJsonLdOfType,
  itemListUrls,
  parseJsonLdProduct,
} from "@rastreador/core";
import { createDb, schema } from "@rastreador/db";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { env } from "./env";
import { politeFetch, politeFetchText } from "./http";

/**
 * Sondeo de tiendas (Fase 1): qué expone cada una y si bloquea, con pocas requests.
 *   pnpm --filter @rastreador/worker probe [tienda...]
 * Guarda el HTML en apps/worker/.probe/ (ignorado por git) y el reporte en docs/sondeo-tiendas.md.
 */
const QUERY = "audifonos bluetooth";
const PROBE_DIR = fileURLToPath(new URL("../.probe/", import.meta.url));
const REPORT = fileURLToPath(new URL("../../../docs/sondeo-tiendas.md", import.meta.url));

interface PageInfo {
  status?: number;
  kb?: number;
  blocked?: string;
  jsonLdTypes: string[];
  itemListUrls: number;
  nextData: boolean;
  platform: string[];
  error?: string;
}

interface ProbeResult {
  id: string;
  name: string;
  robots: string;
  search: PageInfo;
  productUrl?: string;
  product?: PageInfo & { title?: string; price?: number; listPrice?: number; stock?: string };
  api?: string;
}

function detectPlatform(html: string): string[] {
  const p: string[] = [];
  if (/vtex/i.test(html)) p.push("VTEX");
  if (/demandware|\/on\/demandware\.(static|store)/i.test(html)) p.push("SFCC");
  if (/__NEXT_DATA__/.test(html)) p.push("Next.js");
  if (/Magento|mage\/cookies/i.test(html)) p.push("Magento");
  if (/cdn\.shopify\.com/i.test(html)) p.push("Shopify");
  if (/__PRELOADED_STATE__|__INITIAL_STATE__|window\.__STATE__/.test(html)) p.push("estado embebido");
  return p;
}

function emptyInfo(): PageInfo {
  return { jsonLdTypes: [], itemListUrls: 0, nextData: false, platform: [] };
}

async function fetchPage(url: string, storeId: string, saveAs: string): Promise<{ info: PageInfo; html?: string }> {
  const info = emptyInfo();
  try {
    const { res, text } = await politeFetchText(url, { storeId });
    info.status = res.status;
    info.kb = Math.round(text.length / 1024);
    const nodes = extractJsonLd(text);
    info.jsonLdTypes = [...new Set(nodes.map((n) => String(n["@type"])))];
    info.itemListUrls = itemListUrls(nodes).length;
    info.nextData = !!extractNextData(text);
    info.platform = detectPlatform(text);
    await writeFile(`${PROBE_DIR}${saveAs}.html`, text);
    return { info, html: text };
  } catch (err) {
    if (err instanceof AdapterError) {
      if (err.kind === "blocked") info.blocked = err.message;
      else info.error = `${err.kind}: ${err.message}`;
      info.status = err.status;
    } else info.error = (err as Error).message;
    return { info };
  }
}

/** Primer link que parezca ficha de producto del mismo sitio. */
function guessProductUrl(html: string, base: string, nodes = extractJsonLd(html)): string | undefined {
  const fromList = itemListUrls(nodes)[0];
  if (fromList) return new URL(fromList, base).toString();
  const host = new URL(base).host;
  for (const m of html.matchAll(/href="([^"#]+)"/g)) {
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, "&"), base);
      if (u.host !== host) continue;
      if (/\/(p|product|producto|productos)\/|-\d{5,}(\.html)?$|\/\d{6,}(\/|$)|\/p$/i.test(u.pathname)) return u.toString();
    } catch {
      /* href inválido */
    }
  }
  return undefined;
}

async function probeStore(store: typeof schema.stores.$inferSelect): Promise<ProbeResult> {
  const origin = `https://www.${store.domain}`;
  const result: ProbeResult = { id: store.id, name: store.name, robots: "?", search: emptyInfo() };
  console.log(`→ ${store.name}`);

  try {
    const r = await politeFetch(`${origin}/robots.txt`, { storeId: store.id, skipRobots: true });
    const txt = await r.text();
    const delay = txt.match(/crawl-delay:\s*([\d.]+)/i)?.[1];
    result.robots = `${r.status}${delay ? `, crawl-delay ${delay}s` : ""}`;
  } catch (err) {
    result.robots = `error: ${(err as Error).message}`;
  }

  if (!store.searchUrlTemplate) return result;
  const searchUrl = store.searchUrlTemplate.replace("{query}", encodeURIComponent(QUERY));
  const { info, html } = await fetchPage(searchUrl, store.id, `${store.id}-search`);
  result.search = info;

  if (html) {
    const productUrl = guessProductUrl(html, searchUrl);
    if (productUrl) {
      result.productUrl = productUrl;
      const page = await fetchPage(productUrl, store.id, `${store.id}-product`);
      const product = page.html ? findJsonLdOfType(extractJsonLd(page.html), "Product")[0] : undefined;
      const parsed = product ? parseJsonLdProduct(product) : undefined;
      result.product = {
        ...page.info,
        title: parsed?.title,
        price: parsed?.price,
        listPrice: parsed?.listPrice,
        stock: parsed?.stockStatus,
      };
    }
  }

  // Plataformas VTEX (Jumbo, Santa Isabel...) suelen tener una API pública de catálogo.
  if (info.platform.includes("VTEX")) {
    try {
      const api = `${origin}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(QUERY)}&_from=0&_to=1`;
      const res = await politeFetch(api, { storeId: store.id });
      const body = await res.text();
      result.api = `VTEX catálogo: HTTP ${res.status}, ${body.trim().startsWith("[") ? "JSON" : "no JSON"}`;
    } catch (err) {
      result.api = `VTEX catálogo: ${(err as Error).message}`;
    }
  }
  return result;
}

async function probeMercadoLibre(): Promise<string[]> {
  const out: string[] = [];
  const base = "https://api.mercadolibre.com";
  for (const [label, path] of [
    ["Búsqueda pública (/sites/MLC/search)", `/sites/MLC/search?q=${encodeURIComponent(QUERY)}&limit=1`],
    ["Ítem público (/items/{id})", "/items/MLC1000000000"],
  ] as const) {
    try {
      const res = await politeFetch(`${base}${path}`, { storeId: "mercadolibre", skipRobots: true });
      out.push(`${label}: HTTP ${res.status}`);
    } catch (err) {
      const e = err as AdapterError;
      out.push(`${label}: ${e.status ? `HTTP ${e.status}` : e.message}`);
    }
  }
  return out;
}

function fmtPage(p?: PageInfo): string {
  if (!p) return "—";
  if (p.blocked) return `🚫 bloqueado (${p.blocked})`;
  if (p.error) return `⚠️ ${p.error}`;
  const bits = [`HTTP ${p.status}`, `${p.kb} KB`];
  if (p.jsonLdTypes.length) bits.push(`JSON-LD: ${p.jsonLdTypes.join(", ")}`);
  if (p.itemListUrls) bits.push(`ItemList: ${p.itemListUrls}`);
  if (p.nextData) bits.push("__NEXT_DATA__");
  if (p.platform.length) bits.push(p.platform.join(", "));
  return bits.join(" · ");
}

async function main() {
  await mkdir(PROBE_DIR, { recursive: true });
  const only = process.argv.slice(2);
  const db = createDb(env.databaseUrl, { max: 1 });
  const stores = (await db.select().from(schema.stores)).filter(
    (s) => s.id !== "mercadolibre" && (!only.length || only.includes(s.id)),
  );
  await db.$client.end();

  // En paralelo entre tiendas; dentro de cada una, el cliente espera 3 s entre requests.
  const results = await Promise.all(stores.map(probeStore));
  const ml = !only.length || only.includes("mercadolibre") ? await probeMercadoLibre() : [];

  const lines = [
    "# Sondeo de tiendas",
    "",
    `Generado: ${new Date().toISOString()} · Origen: **${env.runner === "gha" ? "GitHub Actions" : "PC local (IP residencial)"}** · Búsqueda de prueba: "${QUERY}"`,
    "",
    "Generado por `pnpm --filter @rastreador/worker probe`. Pocas requests, 3 s entre requests por tienda, robots.txt respetado.",
    "",
    "| Tienda | robots.txt | Búsqueda | Ficha de producto | Precio leído (JSON-LD) |",
    "|---|---|---|---|---|",
    ...results.map((r) => {
      const price = r.product?.price
        ? `$${r.product.price.toLocaleString("es-CL")}${r.product.listPrice ? ` (antes $${r.product.listPrice.toLocaleString("es-CL")})` : ""} · ${r.product.stock}`
        : r.productUrl
          ? "no"
          : "sin ficha";
      return `| ${r.name} | ${r.robots} | ${fmtPage(r.search)} | ${fmtPage(r.product)} | ${price}${r.api ? `<br>${r.api}` : ""} |`;
    }),
    "",
    "## Mercado Libre (API, sin credenciales)",
    "",
    ...ml.map((l) => `- ${l}`),
    "",
  ];
  await writeFile(REPORT, lines.join("\n"));
  console.log(`\nReporte: docs/sondeo-tiendas.md`);
  for (const r of results) console.log(`${r.name.padEnd(14)} búsqueda: ${fmtPage(r.search)}\n${"".padEnd(14)} ficha:    ${fmtPage(r.product)}`);
  ml.forEach((l) => console.log(`Mercado Libre  ${l}`));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
