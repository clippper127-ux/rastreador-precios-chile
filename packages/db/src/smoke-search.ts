import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

/**
 * Prueba de la captura de resultados de búsqueda (solo base de DESARROLLO, requiere `pnpm dev`):
 * usuario temporal con token → POST /api/search-capture → fila guardada con la consulta normalizada.
 *   pnpm --filter @rastreador/db exec tsx src/smoke-search.ts
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const API = process.env.SMOKE_API ?? "http://localhost:3000";
const db = createDb(undefined, { max: 1 });
const userId = randomUUID();
const token = "rpe_" + randomBytes(32).toString("base64url");

const post = async (body: unknown) => {
  const res = await fetch(`${API}/api/search-capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`, detail ?? "");
  if (!cond) ok = false;
};

const results = [
  { url: "https://simple.ripley.cl/audifonos-inalambricos-con-cancelacion-de-ruido-wh-ch720-negro-2000397160149p", title: "AUDÍFONOS INALÁMBRICOS CON CANCELACIÓN DE RUIDO WH-CH720 NEGRO", priceNormal: 99990, priceOffer: 59990, priceCard: 54990, stockStatus: "in_stock" },
  { url: "https://simple.ripley.cl/audifonos-sony-wf-c510-bluetooth-2000403375321p?color=x", title: "AUDÍFONOS SONY WF-C510 BLUETOOTH", priceNormal: 49990, priceOffer: 29990, stockStatus: "in_stock" },
  { url: "https://www.paris.cl/otra-tienda-600379999.html", title: "Mezclado de otra tienda", priceNormal: 1000, stockStatus: "in_stock" },
  { url: "https://simple.ripley.cl/search/no-es-ficha", title: "No es ficha", priceNormal: 1000 },
];

try {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${`smoke-${userId.slice(0, 8)}@example.invalid`}, now(), now(), '{}'::jsonb)`);
  await db.execute(sql`update profiles set extension_token_hash = ${createHash("sha256").update(token).digest("hex")} where id = ${userId}`);

  const r1 = await post({ pageUrl: "https://simple.ripley.cl/search/audifonos%20sony", query: "Audífonos Sony", results });
  check("Captura válida: guarda solo fichas de la misma tienda", r1.status === 200 && r1.body.count === 2, r1.body);

  const [row] = await db.execute<{ query_key: string; store_id: string; n: number; first_url: string }>(sql`
    select query_key, store_id, jsonb_array_length(results)::int as n, results->1->>'url' as first_url
    from search_captures where user_id = ${userId}`);
  check("En la base: consulta normalizada y URL sin query", row?.query_key === "audifono sony" && row?.store_id === "ripley" && !row?.first_url.includes("?"), row);

  const r2 = await post({ pageUrl: "https://www.falabella.com/falabella-cl/search?Ntt=ps5%20slim", results: [results[2]] });
  check("Sin resultados de la tienda de la página → 400", r2.status === 400, r2.body);

  const r3 = await post({ pageUrl: "https://simple.ripley.cl/", results });
  check("Sin consulta → 400", r3.status === 400 && r3.body.error === "sin_consulta", r3.body);
} finally {
  await db.execute(sql`delete from auth.users where id = ${userId}`);
  await db.$client.end();
}
console.log(ok ? "\n✅ Captura de búsqueda OK" : "\n❌ Falló");
process.exitCode = ok ? 0 : 1;
