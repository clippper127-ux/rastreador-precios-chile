import { solotodoSearch } from "@rastreador/core";
import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import * as schema from "./schema";
import { linkSoloTodo, politeSoloTodo, soloTodoPass } from "./solotodo";
import { ensureTracked } from "./track";

/**
 * Prueba de SoloTodo de punta a punta (base de DESARROLLO, API real, usuario temporal):
 *   pnpm --filter @rastreador/db exec tsx --use-system-ca src/smoke-solotodo.ts
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const db = createDb(undefined, { max: 1 });
const userId = randomUUID();
const UA = "RastreadorPreciosPersonal/0.1 (uso personal; seguimiento de precios)";
const ctx = politeSoloTodo({ fetch: (u, i) => fetch(u, { ...i, headers: { "user-agent": UA, ...(i?.headers as Record<string, string>) } }) });
let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`, detail ?? "");
  if (!cond) ok = false;
};

try {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${`smoke-${userId.slice(0, 8)}@example.invalid`}, now(), now(), '{}'::jsonb)`);

  const offers = await solotodoSearch("notebook lenovo ideapad", ctx);
  const blocked = offers.filter((o) => ["falabella", "paris", "ripley", "lider"].includes(o.storeId));
  check("1. SoloTodo trae precios de tiendas que nos bloquean", blocked.length >= 2, blocked.map((o) => o.storeId).join(", "));

  const [a, b] = blocked;
  if (a && b) {
    // a: seguido desde la búsqueda (con id de SoloTodo). b: seguido pegando el link (sin id) → el worker lo enlaza.
    const ta = await ensureTracked(db, userId, { url: a.url, storeId: a.storeId, storeName: a.storeId }, { title: a.title });
    await linkSoloTodo(db, [{ listingId: ta.listingId, entityId: a.solotodoEntityId }]);
    const tb = await ensureTracked(db, userId, { url: b.url, storeId: b.storeId, storeName: b.storeId }, { title: b.title });

    const sum = await soloTodoPass(db, ctx, { refresh: 10, resolve: 10 });
    check("2. Pasada: actualiza el enlazado y enlaza el pegado", sum.refreshed >= 1 && sum.resolved >= 1, sum);

    const snaps = await db
      .select({ listingId: schema.priceSnapshots.listingId, source: schema.priceSnapshots.source, price: schema.priceSnapshots.priceNormal })
      .from(schema.priceSnapshots)
      .where(and(eq(schema.priceSnapshots.source, "feed"), sql`${schema.priceSnapshots.listingId} in (${ta.listingId}, ${tb.listingId})`));
    check("3. Historial con fuente SoloTodo para ambos", new Set(snaps.map((s) => s.listingId)).size === 2, snaps);

    const again = await soloTodoPass(db, ctx, { refresh: 10, resolve: 10 });
    check("4. Segunda pasada inmediata no repite requests (cada 3 h)", again.refreshed === 0 && again.resolved === 0, again);
  }
} finally {
  await db.execute(sql`delete from products p where exists (select 1 from watches w where w.product_id = p.id and w.user_id = ${userId})`);
  await db.execute(sql`delete from auth.users where id = ${userId}`);
  await db.$client.end();
}
console.log(ok ? "\n✅ SoloTodo OK" : "\n❌ Falló");
process.exitCode = ok ? 0 : 1;
