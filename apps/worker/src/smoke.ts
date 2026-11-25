import { createDb, schema } from "@rastreador/db";
import { eq, sql } from "drizzle-orm";
import { env } from "./env";
import { runPass } from "./pass";

/**
 * Prueba de humo del worker contra la base real, sin tocar datos de usuarios:
 * crea un producto+listing temporal (sin watch), corre dos pasadas y verifica que
 * la primera guarda un snapshot y la segunda NO (precio sin cambios). Luego borra todo.
 *   pnpm --filter @rastreador/worker smoke "<url de ficha>"
 */
const url = process.argv[2] ?? "https://hites.com/audifonos-bluetooth-sonos-ace-over-ear-headphone-negros-10063000579.html";
const storeId = process.argv[3] ?? "hites";

const db = createDb(env.databaseUrl, { max: 4 });
const [product] = await db.insert(schema.products).values({ canonicalName: "Pendiente: prueba de humo" }).returning();
const [listing] = await db
  .insert(schema.listings)
  .values({ productId: product!.id, storeId, url: `${url}?smoke=${Date.now()}`, title: "prueba" })
  .returning();

const count = async () =>
  (await db.execute<{ n: number }>(sql`select count(*)::int as n from price_snapshots where listing_id = ${listing!.id}`))[0]!.n;

let ok = true;
try {
  // Solo este listing debe quedar vencido; los demás (si hay) se procesan igual, es inofensivo.
  const first = await runPass(db);
  const afterFirst = await count();
  const l1 = await db.query.listings.findFirst({ where: eq(schema.listings.id, listing!.id) });
  const p1 = await db.query.products.findFirst({ where: eq(schema.products.id, product!.id) });
  console.log("Pasada 1:", { revisados: first.checked, cambios: first.snapshots, errores: first.errors, snapshots: afterFirst });
  console.log("  listing:", {
    titulo: l1?.title,
    normal: l1?.priceNormal,
    oferta: l1?.priceOffer,
    stock: l1?.stockStatus,
    proximo: l1?.nextCheckAt,
    error: l1?.lastError,
  });
  console.log("  producto canónico:", p1?.canonicalName, "·", p1?.brand);
  if (afterFirst !== 1) ok = false;

  // Forzar que vuelva a vencer y correr otra pasada: el precio no cambió → sin snapshot nuevo.
  await db.update(schema.listings).set({ nextCheckAt: sql`now()` }).where(eq(schema.listings.id, listing!.id));
  const second = await runPass(db);
  const afterSecond = await count();
  console.log("Pasada 2:", { revisados: second.checked, cambios: second.snapshots, snapshots: afterSecond });
  if (afterSecond !== 1) ok = false;

  const store = await db.query.stores.findFirst({ where: eq(schema.stores.id, storeId) });
  console.log("Salud de la tienda:", { estado: store?.status, ultimoExito: store?.lastSuccessAt });
} finally {
  await db.delete(schema.products).where(eq(schema.products.id, product!.id));
  await db.$client.end();
}
console.log(ok ? "✅ Prueba de humo OK" : "❌ Prueba de humo FALLÓ");
process.exitCode = ok ? 0 : 1;
