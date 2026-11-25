import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import { stores, storeRate } from "./schema";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

type Store = typeof stores.$inferInsert;

/**
 * Configuración de tiendas según el sondeo real (docs/sondeo-tiendas.md, 2026-11-24, IP residencial).
 * `upsert`: correrlo de nuevo actualiza la configuración sin tocar el estado de salud.
 * `enabled = false` hasta que exista su adaptador o la extensión (Fase 3).
 */
const seed: Store[] = [
  // ── Servidor: responden y exponen JSON-LD ──────────────────────────────────
  {
    id: "hites",
    name: "Hites",
    domain: "hites.com",
    sourceChain: ["server", "extension", "pricto", "manual"],
    searchMode: "server",
    searchUrlTemplate: "https://www.hites.com/search?q={query}",
    minCheckIntervalMin: 360,
    maxRequestsPerMin: 10,
    enabled: true,
    notes: "SFCC. Ficha y búsqueda con JSON-LD. Normal/oferta en bloque .prices.",
  },
  {
    id: "lapolar",
    name: "La Polar",
    domain: "lapolar.cl",
    sourceChain: ["server", "extension", "pricto", "manual"],
    searchMode: "link",
    searchUrlTemplate: "https://www.lapolar.cl/search?q={query}",
    minCheckIntervalMin: 360,
    maxRequestsPerMin: 10,
    enabled: true,
    notes: "SFCC (mismo adaptador que Hites). robots.txt prohíbe /search: búsqueda por link.",
  },
  {
    id: "abcdin",
    name: "Abcdin",
    domain: "abc.cl",
    sourceChain: ["server", "extension", "pricto", "manual"],
    searchMode: "link",
    searchUrlTemplate: "https://www.abc.cl/search?q={query}",
    minCheckIntervalMin: 360,
    maxRequestsPerMin: 10,
    enabled: true,
    notes: "SFCC (mismo adaptador que Hites). robots.txt prohíbe /search: búsqueda por link.",
  },
  {
    id: "jumbo",
    name: "Jumbo",
    domain: "jumbo.cl",
    sourceChain: ["server", "extension", "pricto", "manual"],
    searchMode: "server",
    searchUrlTemplate: "https://www.jumbo.cl/busqueda?ft={query}",
    minCheckIntervalMin: 720,
    maxRequestsPerMin: 6,
    enabled: false,
    notes: "VTEX. Búsqueda (ItemList) y ficha (Product) con JSON-LD. API de catálogo: 404. Adaptador en Fase 6.",
  },
  {
    id: "santaisabel",
    name: "Santa Isabel",
    domain: "santaisabel.cl",
    sourceChain: ["server", "extension", "pricto", "manual"],
    searchMode: "server",
    searchUrlTemplate: "https://www.santaisabel.cl/busqueda?ft={query}",
    minCheckIntervalMin: 720,
    maxRequestsPerMin: 6,
    enabled: false,
    notes: "VTEX, crawl-delay 1 s. JSON-LD en búsqueda y ficha. robots prohíbe la API de catálogo. Fase 6.",
  },
  {
    id: "pcfactory",
    name: "PC Factory",
    domain: "pcfactory.cl",
    sourceChain: ["server", "extension", "manual"],
    searchMode: "link",
    searchUrlTemplate: "https://www.pcfactory.cl/buscar?valor={query}",
    minCheckIntervalMin: 360,
    maxRequestsPerMin: 6,
    enabled: false,
    notes: "robots.txt prohíbe /buscar y /busqueda; fichas /producto/ permitidas. Falta sondear la ficha. Fase 6.",
  },

  // ── API oficial ────────────────────────────────────────────────────────────
  {
    id: "mercadolibre",
    name: "Mercado Libre",
    domain: "mercadolibre.cl",
    sourceChain: ["api", "extension", "manual"],
    searchMode: "link",
    searchUrlTemplate: "https://listado.mercadolibre.cl/{query}",
    minCheckIntervalMin: 240,
    maxRequestsPerMin: 30,
    enabled: false,
    notes: "API sin credenciales: 403 en /sites/MLC/search y /items. Requiere app registrada (OAuth).",
  },

  // ── Extensión: bloquean al servidor ────────────────────────────────────────
  ...(
    [
      ["falabella", "Falabella", "falabella.com", "https://www.falabella.com/falabella-cl/search?Ntt={query}", "Búsqueda responde (ItemList + __NEXT_DATA__), ficha 403."],
      ["paris", "Paris", "paris.cl", "https://www.paris.cl/search?q={query}", "403 al worker incluso en robots.txt (filtro por huella del cliente). No se elude."],
      ["ripley", "Ripley", "ripley.cl", "https://simple.ripley.cl/search/{query}", "403 en robots.txt y búsqueda."],
      ["lider", "Lider", "lider.cl", "https://www.lider.cl/search?q={query}", "Página de desafío anti-bot."],
      ["tottus", "Tottus", "tottus.cl", "https://www.tottus.cl/tottus-cl/buscar?Ntt={query}", "403 en búsqueda."],
      ["sodimac", "Sodimac", "sodimac.cl", "https://www.sodimac.cl/sodimac-cl/search?Ntt={query}", "Búsqueda 200 con __NEXT_DATA__ sin productos visibles; falta sondear ficha."],
      ["spdigital", "SP Digital", "spdigital.cl", "https://www.spdigital.cl/search?q={query}", "robots.txt 503, búsqueda 403."],
    ] as const
  ).map(
    ([id, name, domain, searchUrlTemplate, notes]): Store => ({
      id,
      name,
      domain,
      sourceChain: ["extension", "server", "manual"],
      searchMode: "link",
      searchUrlTemplate,
      // Chequeo de servidor muy espaciado: solo para detectar si dejan de bloquear.
      minCheckIntervalMin: 1440,
      maxRequestsPerMin: 2,
      // Activas vía extensión (Fase 3): Falabella, Paris, Ripley, Lider.
      enabled: ["falabella", "paris", "ripley", "lider"].includes(id),
      notes,
    }),
  ),
];

const db = createDb(undefined, { max: 1 });
for (const s of seed) {
  await db
    .insert(stores)
    .values(s)
    .onConflictDoUpdate({
      target: stores.id,
      set: {
        name: s.name,
        domain: s.domain,
        sourceChain: s.sourceChain,
        searchMode: s.searchMode,
        searchUrlTemplate: s.searchUrlTemplate,
        minCheckIntervalMin: s.minCheckIntervalMin,
        maxRequestsPerMin: s.maxRequestsPerMin,
        enabled: s.enabled,
        notes: s.notes,
      },
    });
  await db.insert(storeRate).values({ storeId: s.id }).onConflictDoNothing();
}
const [{ count } = { count: 0 }] = await db.execute<{ count: number }>(sql`select count(*)::int as count from stores`);
console.log(`Tiendas en la base: ${count}`);
await db.$client.end();
