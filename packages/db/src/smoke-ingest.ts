import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

/**
 * Prueba de punta a punta de la API de la extensión (solo base de DESARROLLO):
 * crea un usuario temporal con token, recorre seguir → capturar → sin cambios → cambio de precio,
 * verifica la base y borra todo al final. Requiere la web corriendo (pnpm dev).
 *   pnpm --filter @rastreador/db exec tsx src/smoke-ingest.ts
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const API = process.env.SMOKE_API ?? "http://localhost:3000";
const db = createDb(undefined, { max: 1 });

const userId = randomUUID();
const token = "rpe_" + randomBytes(32).toString("base64url");
const url = `https://www.paris.cl/producto-de-prueba-${Date.now() % 1_000_000_000}999.html`;

async function post(capture: Record<string, unknown>, follow: boolean) {
  const res = await fetch(`${API}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ capture, follow }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const base = { url, title: "Producto de prueba", brand: "Prueba", stockStatus: "in_stock", priceNormal: 159990, priceOffer: 129990 };
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
  await db.execute(sql`update profiles set extension_token_hash = ${createHash("sha256").update(token).digest("hex")} where id = ${userId}`);

  const r1 = await post(base, false);
  check("Ficha no seguida + follow=false → no guarda nada", r1.status === 200 && r1.body.tracked === false, r1.body);

  const r2 = await post(base, true);
  check("Seguir desde la extensión → tracked + primer snapshot", r2.body.tracked === true && r2.body.changed === true, r2.body);

  const r3 = await post(base, false);
  check("Misma visita sin cambios → sin snapshot nuevo", r3.body.tracked === true && r3.body.changed === false);

  const r4 = await post({ ...base, priceOffer: 119990, priceCard: 109990, cardName: "Tarjeta Cencosud" }, false);
  check("Baja de precio → snapshot nuevo", r4.body.changed === true && r4.body.minPrice90d === 119990, {
    min: r4.body.minPrice90d,
    puntos: (r4.body.points as unknown[])?.length,
  });

  const r5 = await post({ ...base, url: "https://www.paris.cl/electro/audio/" }, true);
  check("Página que no es ficha → 400", r5.status === 400, r5.body);

  const [row] = await db.execute<{ snaps: number; src: string; card: number | null; title: string }>(sql`
    select count(s.*)::int as snaps, min(s.source::text) as src, max(l.price_card) as card, max(l.title) as title
    from listings l left join price_snapshots s on s.listing_id = l.id
    where l.product_id = ${r2.body.productId as string}`);
  check("En la base: 2 snapshots de fuente 'extension' y precio con tarjeta guardado aparte", row?.snaps === 2 && row?.src === "extension" && row?.card === 109990, row);
} finally {
  await db.execute(sql`delete from products p where exists (select 1 from watches w where w.product_id = p.id and w.user_id = ${userId})`);
  await db.execute(sql`delete from auth.users where id = ${userId}`);
  await db.$client.end();
}
console.log(ok ? "\n✅ API de la extensión OK" : "\n❌ Falló");
process.exitCode = ok ? 0 : 1;
