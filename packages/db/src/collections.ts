import { formatCLP } from "@rastreador/core";
import { eq, sql } from "drizzle-orm";
import type { Transport } from "./alerts";
import type { Database } from "./client";
import * as schema from "./schema";

/*
 * Listas con presupuesto: total = suma del mejor precio actual (sin tarjeta, con stock) de cada producto.
 * Se avisa una vez cuando la lista completa queda bajo el presupuesto; se rearma si vuelve a pasarse.
 */

export interface CollectionTotal {
  id: string;
  userId: string;
  name: string;
  budget: number | null;
  notifiedTotal: number | null;
  items: number;
  priced: number;
  total: number;
}

/** Totales de las listas (de un usuario o de todos). */
export async function collectionTotals(db: Database, userId?: string): Promise<CollectionTotal[]> {
  const rows = await db.execute<{
    id: string;
    user_id: string;
    name: string;
    budget: number | null;
    notified_total: number | null;
    items: number;
    priced: number;
    total: number;
  }>(sql`
    with best as (
      select ci.collection_id, ci.watch_id,
        min(least(l.price_offer, l.price_normal)) filter (where l.stock_status in ('in_stock','preorder','unknown')) as price
      from collection_items ci
      join watch_listings wl on wl.watch_id = ci.watch_id and wl.enabled
      join listings l on l.id = wl.listing_id
      group by ci.collection_id, ci.watch_id
    )
    select c.id, c.user_id, c.name, c.budget, c.notified_total,
      (select count(*)::int from collection_items ci where ci.collection_id = c.id) as items,
      count(b.price)::int as priced,
      coalesce(sum(b.price), 0)::int as total
    from collections c
    left join best b on b.collection_id = c.id
    ${userId ? sql`where c.user_id = ${userId}` : sql``}
    group by c.id
    order by c.created_at`);
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    budget: r.budget,
    notifiedTotal: r.notified_total,
    items: r.items,
    priced: r.priced,
    total: r.total,
  }));
}

export async function checkCollectionBudgets(db: Database, appUrl: string, transport: Transport): Promise<number> {
  let notified = 0;
  for (const c of await collectionTotals(db)) {
    if (c.budget == null || c.items === 0) continue;
    const complete = c.priced === c.items;
    const under = complete && c.total <= c.budget;
    if (!under) {
      if (c.notifiedTotal != null && c.total > c.budget) {
        await db.update(schema.collections).set({ notifiedTotal: null }).where(eq(schema.collections.id, c.id));
      }
      continue;
    }
    if (c.notifiedTotal != null && c.total >= c.notifiedTotal) continue; // ya avisado y no bajó más

    const profile = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, c.userId) });
    const text = [
      `🛒 Tu lista "${c.name}" quedó bajo el presupuesto`,
      `Total: ${formatCLP(c.total)} · presupuesto ${formatCLP(c.budget)} (${c.items} productos)`,
      "",
      `Ver lista: ${appUrl.replace(/\/+$/, "")}/listas/${c.id}`,
    ].join("\n");
    try {
      if (profile?.telegramChatId) await transport.telegram(profile.telegramChatId, text);
      else if (profile?.emailAlerts) {
        const [u] = await db.execute<{ email: string | null }>(sql`select email from auth.users where id = ${c.userId}`);
        if (u?.email) await transport.email(u.email, `Tu lista "${c.name}" quedó bajo el presupuesto`, text);
      }
    } catch {
      continue; // se reintenta en la próxima pasada
    }
    await db.update(schema.collections).set({ notifiedTotal: c.total }).where(eq(schema.collections.id, c.id));
    notified++;
  }
  return notified;
}
