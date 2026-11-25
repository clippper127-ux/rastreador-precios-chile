import { adapters, offerFromEntity, parseListingUrl, solotodoEntity, solotodoSearch, type AdapterContext } from "@rastreador/core";
import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import * as schema from "./schema";
import { recordCapture } from "./track";

/*
 * Precios vía SoloTodo para las tiendas que bloquean a nuestro servidor (Falabella, Paris, Ripley, Lider…).
 * Sin la extensión, estos productos igual se actualizan. Uso moderado: pausa entre requests y tope por pasada.
 */

const SERVER_STORES = adapters.map((a) => a.id);
const REFRESH_EVERY_MS = 3 * 3_600_000;
const RESOLVE_EVERY_MS = 7 * 24 * 3_600_000;

/** Envuelve fetch con una pausa mínima entre requests (cortesía con la API pública). */
export function politeSoloTodo(ctx: AdapterContext, gapMs = 800): AdapterContext {
  let last = 0;
  return {
    fetch: async (url, init) => {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return ctx.fetch(url, init);
    },
  };
}

export interface SoloTodoSummary {
  refreshed: number;
  changed: number;
  resolved: number;
  errors: number;
}

/**
 * 1) Actualiza el precio de las publicaciones ya enlazadas a SoloTodo (tiendas sin adaptador de servidor).
 * 2) Intenta enlazar las que aún no lo están, buscando su título en SoloTodo y comparando el link.
 */
export async function soloTodoPass(db: Database, ctx: AdapterContext, opts: { refresh?: number; resolve?: number } = {}): Promise<SoloTodoSummary> {
  const sum: SoloTodoSummary = { refreshed: 0, changed: 0, resolved: 0, errors: 0 };
  const api = politeSoloTodo(ctx);
  const followed = sql`exists (select 1 from watch_listings wl join watches w on w.id = wl.watch_id where wl.listing_id = ${schema.listings.id} and wl.enabled and w.active)`;

  const toRefresh = await db
    .select({ id: schema.listings.id, entity: schema.listings.solotodoEntityId })
    .from(schema.listings)
    .where(
      and(
        eq(schema.listings.status, "active"),
        isNotNull(schema.listings.solotodoEntityId),
        notInArray(schema.listings.storeId, SERVER_STORES),
        or(isNull(schema.listings.lastCheckedAt), lt(schema.listings.lastCheckedAt, new Date(Date.now() - REFRESH_EVERY_MS))),
        followed,
      ),
    )
    .limit(opts.refresh ?? 60);

  for (const l of toRefresh) {
    try {
      const offer = offerFromEntity(await solotodoEntity(l.entity!, api));
      if (!offer) {
        await db.update(schema.listings).set({ solotodoEntityId: null }).where(eq(schema.listings.id, l.id));
        continue;
      }
      const { changed } = await recordCapture(db, l.id, offer, "feed", null);
      sum.refreshed++;
      if (changed) sum.changed++;
    } catch (err) {
      sum.errors++;
      if (/ 404$/.test((err as Error).message)) {
        await db.update(schema.listings).set({ solotodoEntityId: null }).where(eq(schema.listings.id, l.id));
      }
    }
  }

  const toResolve = await db
    .select({ id: schema.listings.id, url: schema.listings.url, title: schema.listings.title })
    .from(schema.listings)
    .where(
      and(
        eq(schema.listings.status, "active"),
        isNull(schema.listings.solotodoEntityId),
        notInArray(schema.listings.storeId, SERVER_STORES),
        or(isNull(schema.listings.solotodoCheckedAt), lt(schema.listings.solotodoCheckedAt, new Date(Date.now() - RESOLVE_EVERY_MS))),
        followed,
      ),
    )
    .limit(opts.resolve ?? 15);

  for (const l of toResolve) {
    try {
      const query = l.title.replace(/^Pendiente:\s*/, "").slice(0, 80);
      const offers = query.length >= 4 ? await solotodoSearch(query, api, 8) : [];
      const target = parseListingUrl(l.url);
      const hit = target.ok ? offers.find((o) => o.url === target.url) : undefined;
      await db
        .update(schema.listings)
        .set({ solotodoCheckedAt: new Date(), ...(hit && { solotodoEntityId: hit.solotodoEntityId }) })
        .where(eq(schema.listings.id, l.id));
      if (hit) {
        sum.resolved++;
        const { changed } = await recordCapture(db, l.id, hit, "feed", null);
        if (changed) sum.changed++;
      }
    } catch {
      sum.errors++;
      await db.update(schema.listings).set({ solotodoCheckedAt: new Date() }).where(eq(schema.listings.id, l.id));
    }
  }
  return sum;
}

/** Guarda el enlace a SoloTodo de publicaciones seguidas desde la búsqueda. */
export async function linkSoloTodo(db: Database, pairs: { listingId: string; entityId: number }[]): Promise<void> {
  for (const p of pairs) {
    await db
      .update(schema.listings)
      .set({ solotodoEntityId: p.entityId, solotodoCheckedAt: new Date() })
      .where(and(eq(schema.listings.id, p.listingId), inArray(schema.listings.status, ["active"])));
  }
}
