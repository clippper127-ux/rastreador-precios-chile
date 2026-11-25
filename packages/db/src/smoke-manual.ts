import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import * as schema from "./schema";
import { ensureTracked } from "./track";

/**
 * Prueba de productos creados a mano (solo base de DESARROLLO): juntar links de varias tiendas en un producto,
 * mover un link suelto y respetar productos que sigue otra persona.
 *   pnpm --filter @rastreador/db exec tsx src/smoke-manual.ts
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const db = createDb(undefined, { max: 1 });
const me = randomUUID();
const other = randomUUID();
let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`, detail ?? "");
  if (!cond) ok = false;
};
const stamp = Date.now() % 1_000_000_000;
const ref = (store: string, n: number) => ({ url: `https://paris.cl/manual-${store}-${stamp}${n}.html`, storeId: "paris", storeName: "Paris" });
const newProduct = async (name: string) => (await db.insert(schema.products).values({ canonicalName: name }).returning())[0]!.id;
const productOf = async (listingId: string) =>
  (await db.select({ p: schema.listings.productId }).from(schema.listings).where(eq(schema.listings.id, listingId)))[0]?.p;

try {
  for (const id of [me, other]) {
    await db.execute(sql`
      insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
      values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`smoke-${id.slice(0, 8)}@example.invalid`}, now(), now(), '{}'::jsonb)`);
  }

  // 1. Producto a mano con 2 links nuevos → un solo producto con ambos.
  const manual = await newProduct("Consola PS5 (a mano)");
  const a = await ensureTracked(db, me, ref("a", 1), undefined, manual);
  const b = await ensureTracked(db, me, ref("b", 2), undefined, manual);
  check("1. Dos links nuevos quedan en el producto a mano", a.productId === manual && b.productId === manual);

  // 2. Un link que yo ya seguía suelto se mueve al producto y el suelto desaparece.
  const loose = await ensureTracked(db, me, ref("c", 3));
  const moved = await ensureTracked(db, me, ref("c", 3), undefined, manual);
  const oldGone = !(await db.select().from(schema.products).where(eq(schema.products.id, loose.productId))).length;
  check("2. Link suelto propio se mueve y se borra el producto vacío", moved.productId === manual && oldGone && loose.listingId === moved.listingId);

  // 3. Un link que otra persona sigue NO se mueve (no se le quita nada).
  const shared = await ensureTracked(db, other, ref("d", 4));
  const tried = await ensureTracked(db, me, ref("d", 4), undefined, manual);
  check("3. Link que sigue otra persona no se mueve", tried.productId === shared.productId && (await productOf(shared.listingId)) === shared.productId);

  const watches = await db.select().from(schema.watches).where(eq(schema.watches.userId, me));
  check("4. Mis seguimientos: el producto a mano + el compartido", watches.length === 2, watches.length);
} finally {
  for (const id of [me, other]) {
    await db.execute(sql`delete from products p where exists (select 1 from watches w where w.product_id = p.id and w.user_id = ${id})`);
    await db.execute(sql`delete from auth.users where id = ${id}`);
  }
  await db.$client.end();
}
console.log(ok ? "\n✅ Productos a mano OK" : "\n❌ Falló");
process.exitCode = ok ? 0 : 1;
