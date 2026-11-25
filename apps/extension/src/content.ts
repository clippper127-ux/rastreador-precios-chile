import {
  extensionStoreForUrl,
  falabellaFromNextData,
  formatCLP,
  genericCapture,
  toCLP,
  type CapturedProduct,
  type ExtensionStore,
  type PriceCandidate,
} from "@rastreador/core";
import { renderPanel } from "./panel";
import type { IngestResponse, Msg } from "./shared";

/*
 * Corre solo en fichas de producto de tiendas soportadas. Lee lo que el usuario YA está viendo
 * (sin requests propias a la tienda) y se lo pasa al service worker.
 */

const PRICE_RE = /^\$\s?\d{1,3}(?:\.\d{3})+$|^\$\s?\d{3,}$/;
const CARD_HINT_RE = /tarjeta|cmr|cencosud|credit|cr[eé]dito|card|ripley|bci/i;

function isCrossed(el: Element): boolean {
  for (let e: Element | null = el, i = 0; e && i < 3; e = e.parentElement, i++) {
    if (getComputedStyle(e).textDecorationLine.includes("line-through")) return true;
    if (e.tagName === "DEL" || e.tagName === "S") return true;
  }
  return false;
}

function labelFor(el: Element): string {
  for (let e: Element | null = el.parentElement, i = 0; e && i < 3; e = e.parentElement, i++) {
    const t = (e as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
    if (t.length > 0 && t.length <= 60) return t;
  }
  return "";
}

function cardHintFor(el: Element): boolean {
  for (let e: Element | null = el, i = 0; e && i < 3; e = e.parentElement, i++) {
    if (CARD_HINT_RE.test(String((e as HTMLElement).className ?? ""))) return true;
    const imgs = e.querySelectorAll("img,svg[aria-label]");
    for (const img of imgs) {
      const hint = `${img.getAttribute("alt") ?? ""} ${img.getAttribute("aria-label") ?? ""} ${img.getAttribute("src") ?? ""}`;
      if (CARD_HINT_RE.test(hint)) return true;
    }
  }
  return false;
}

/** Contenedor del producto: sube desde el h1 hasta encontrar precios, sin llegar a la página completa. */
function productContainer(h1: Element): HTMLElement | null {
  let box: HTMLElement | null = h1 as HTMLElement;
  for (let i = 0; i < 8 && box; i++) {
    const text = box.innerText ?? "";
    if ((text.match(/\$\s?\d/g)?.length ?? 0) >= 1 && text.length < 6000) return box;
    box = box.parentElement;
  }
  return null;
}

function collectCandidates(box: HTMLElement): PriceCandidate[] {
  const pick = (maxChildren: number) =>
    [...box.querySelectorAll("*")].filter(
      (e) => e.children.length <= maxChildren && PRICE_RE.test((e.textContent ?? "").trim()) && (e as HTMLElement).offsetParent !== null,
    );
  let els = pick(0);
  if (!els.length) els = pick(2);
  const seen = new Set<string>();
  const out: PriceCandidate[] = [];
  for (const el of els) {
    const value = toCLP((el.textContent ?? "").trim());
    if (value == null) continue;
    const cand = { value, crossed: isCrossed(el), label: labelFor(el), cardHint: cardHintFor(el) };
    const key = `${cand.value}|${cand.crossed}|${cand.cardHint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cand);
  }
  return out;
}

function jsonLdProduct(): Record<string, unknown> | undefined {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? "");
      const nodes = (Array.isArray(data) ? data : [data]).flatMap((n) => (Array.isArray(n?.["@graph"]) ? n["@graph"] : [n]));
      const p = nodes.find((n) => n?.["@type"] === "Product" || (Array.isArray(n?.["@type"]) && n["@type"].includes("Product")));
      if (p) return p;
    } catch {
      /* JSON-LD inválido: ignorar */
    }
  }
  return undefined;
}

function meta(prop: string): string | undefined {
  return document.querySelector(`meta[property="${prop}"]`)?.getAttribute("content") ?? undefined;
}

export function capturePage(store: ExtensionStore): CapturedProduct | null {
  const url = location.href;

  // Falabella: __NEXT_DATA__ es exacto, pero solo vale si corresponde a ESTA ficha
  // (en navegación interna de Next.js queda el de la primera página).
  if (store.id === "falabella") {
    let nd: unknown;
    try {
      nd = JSON.parse(document.getElementById("__NEXT_DATA__")?.textContent ?? "null");
    } catch {
      nd = null;
    }
    const productId = location.pathname.match(/\/product\/(\d+)/)?.[1];
    const pdId = (nd as { props?: { pageProps?: { productData?: { id?: string } } } })?.props?.pageProps?.productData?.id;
    if (nd && productId && pdId === productId) {
      const p = falabellaFromNextData(nd, url);
      if (p && (p.priceNormal ?? p.priceOffer) != null) return p;
    }
  }

  const h1 = document.querySelector("h1");
  if (!h1) return null;
  const box = productContainer(h1);
  if (!box) return null;
  const text = box.innerText;
  return genericCapture(
    {
      url,
      h1: h1.textContent ?? undefined,
      jsonLdProduct: jsonLdProduct(),
      ogTitle: meta("og:title"),
      ogImage: meta("og:image"),
      candidates: collectCandidates(box),
      outOfStockHint: /agotado|sin stock|no disponible para compra/i.test(text) && !/agregar al carro/i.test(text),
      sellerText: text.match(/vendido por\s*:?\s*\n?\s*([^\n]{2,60})/i)?.[1],
    },
    store,
  );
}

async function send(capture: CapturedProduct, follow: boolean): Promise<IngestResponse> {
  try {
    return (await chrome.runtime.sendMessage({ type: "capture", capture, follow } satisfies Msg)) as IngestResponse;
  } catch {
    return { error: "extension_recargada" };
  }
}

let lastUrl = "";
let running = false;

async function run() {
  const store = extensionStoreForUrl(location.href);
  if (!store || !store.productPath.test(location.pathname)) {
    renderPanel(null);
    return;
  }
  if (running) return;
  running = true;
  try {
    // Las tiendas cargan precios después del HTML: reintenta hasta ~8 s.
    let capture: CapturedProduct | null = null;
    for (let i = 0; i < 8 && !capture; i++) {
      capture = capturePage(store);
      if (!capture) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!capture) {
      renderPanel({ store, capture: null, state: { error: "no_leido" }, onFollow: () => {} });
      return;
    }
    const cap = capture;
    const render = (state: IngestResponse, busy = false) =>
      renderPanel({
        store,
        capture: cap,
        state,
        busy,
        onFollow: async () => {
          render(state, true);
          render(await send(cap, true));
        },
      });
    render({}, true);
    render(await send(cap, false));
  } finally {
    running = false;
  }
}

// Primera carga + navegación interna (Falabella y Ripley son apps de una sola página).
function tick() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    void run();
  }
}
tick();
setInterval(tick, 1000);

// Para depurar desde la consola de la página: window.__rastreadorCapture()
(globalThis as unknown as Record<string, unknown>).__rastreadorCapture = () => {
  const s = extensionStoreForUrl(location.href);
  const c = s ? capturePage(s) : null;
  console.table(c ? { ...c, priceNormal: formatCLP(c.priceNormal), priceOffer: formatCLP(c.priceOffer), priceCard: formatCLP(c.priceCard) } : {});
  return c;
};
