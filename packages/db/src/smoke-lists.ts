import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Transport } from "./alerts";
import { createDb } from "./client";
import { checkCollectionBudgets, collectionTotals } from "./collections";
import * as schema from "./schema";
import { ensureTracked, recordCapture } from "./track";

/**
 * Prueba de listas con presupuesto (solo base de DESARROLLO), con transporte falso.
 *   pnpm --filter @rastreador/db exec tsx src/smoke-lists.ts
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const db = createDb(undefined, { max: 1 });
const userId = randomUUID();
const sent: string[] = [];
const fake: Transport = { telegram: async (_c, t) => void sent.push(t), email: async (_t, _s, t) => void sent.push(t) };
let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`, detail ?? "");
  if (!cond) ok = false;
};
const stamp = Date.now() % 1_000_000_000;
const price = async (listingId: string, url: string, p: number) =>
  recordCapture(db, listingId, { url, title: "x", priceNormal: p, stockStatus: "in_stock" }, "manual", userId);

try {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${`smoke-${userId.slice(0, 8)}@example.invalid`}, now(), now(), '{}'::jsonb)`);
  await db.execute(sql`update profiles set telegram_chat_id = 777 where id = ${userId}`);

  const urlA = `https://paris.cl/lista-a-${stamp}999.html`;
  const urlB = `https://paris.cl/lista-b-${stamp}998.html`;
  const a = await ensureTracked(db, userId, { url: urlA, storeId: "paris", storeName: "Paris" }, { title: "Consola" });
  const b = await ensureTracked(db, userId, { url: urlB, storeId: "paris", storeName: "Paris" }, { title: "Control" });
  const [list] = await db.insert(schema.collections).values({ userId, name: "Navidad", budget: 500000 }).returning();
  const watches = await db.select().from(schema.watches).where(sql`user_id = ${userId}`);
  await db.insert(schema.collectionItems).values(watches.map((w) => ({ collectionId: list!.id, watchId: w.id })));

  await price(a.listingId, urlA, 450000);
  let n = await checkCollectionBudgets(db, "http://localhost:3000", fake);
  check("1. Un producto sin precio: no avisa aunque el total sea bajo", n === 0);

  await price(b.listingId, urlB, 80000);
  const [t] = await collectionTotals(db, userId);
  check("2. Total = suma de mejores precios", t?.total === 530000 && t?.priced === 2, t);
  n = await checkCollectionBudgets(db, "http://localhost:3000", fake);
  check("   Sobre el presupuesto ($530.000 > $500.000): no avisa", n === 0);

  await price(a.listingId, urlA, 399990);
  n = await checkCollectionBudgets(db, "http://localhost:3000", fake);
  check("3. Baja a $479.990: avisa una vez", n === 1 && sent[0]!.includes("Navidad") && sent[0]!.includes("$479.990"), "\n" + sent[0]);
  n = await checkCollectionBudgets(db, "http://localhost:3000", fake);
  check("   No repite si no cambia", n === 0);

  await price(b.listingId, urlB, 70000);
  n = await checkCollectionBudgets(db, "http://localhost:3000", fake);
  check("4. Baja más ($469.990): vuelve a avisar", n === 1);

  await price(a.listingId, urlA, 460000);
  await checkCollectionBudgets(db, "http://localhost:3000", fake);
  const [after] = await db.select().from(schema.collections).where(sql`id = ${list!.id}`);
  check("5. Se pasa del presupuesto: se rearma", after?.notifiedTotal == null, after?.notifiedTotal);
} finally {
  await db.execute(sql`delete from products p where exists (select 1 from watches w where w.product_id = p.id and w.user_id = ${userId})`);
  await db.execute(sql`delete from auth.users where id = ${userId}`);
  await db.$client.end();
}
console.log(ok ? "\n✅ Listas OK" : "\n❌ Falló");
process.exitCode = ok ? 0 : 1;
