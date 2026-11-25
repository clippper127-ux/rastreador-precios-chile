import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { deliverPendingAlerts, type Transport } from "./alerts";
import { createDb } from "./client";
import { ensureTracked, recordCapture } from "./track";

/**
 * Prueba de punta a punta de las alertas (solo base de DESARROLLO), con un transporte falso:
 * usuario temporal con Telegram "vinculado" y correo, reglas de objetivo + % + mínimo histórico,
 * una secuencia de precios y verificación de qué se avisa, cuándo y que no se repite.
 *   pnpm --filter @rastreador/db exec tsx src/smoke-alerts.ts
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const db = createDb(undefined, { max: 1 });
const userId = randomUUID();
const sent: { channel: string; text: string }[] = [];
const fake: Transport = {
  telegram: async (_chat, text) => void sent.push({ channel: "telegram", text }),
  email: async (_to, subject, text) => void sent.push({ channel: "email", text: `${subject}\n${text}` }),
};
const cfg = { appUrl: "http://localhost:3000" };

let ok = true;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`, detail ?? "");
  if (!cond) ok = false;
};

const url = `https://paris.cl/prueba-alertas-${Date.now() % 1_000_000_000}999.html`;
const cap = (priceOffer: number, stockStatus: "in_stock" | "out_of_stock" = "in_stock") => ({
  url,
  title: "PS5 Slim de prueba",
  priceNormal: 499990,
  priceOffer,
  stockStatus,
});
const step = async (price: number, stock: "in_stock" | "out_of_stock" = "in_stock") => {
  sent.length = 0;
  await recordCapture(db, listingId, cap(price, stock), "manual", userId);
  await deliverPendingAlerts(db, cfg, fake);
  return [...sent];
};

let listingId = "";
try {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${`smoke-${userId.slice(0, 8)}@example.invalid`}, now(), now(), '{}'::jsonb)`);
  await db.execute(sql`update profiles set telegram_chat_id = 123456789, email_alerts = true where id = ${userId}`);

  const ids = await ensureTracked(db, userId, { url, storeId: "paris", storeName: "Paris" }, { title: "PS5 Slim de prueba" });
  listingId = ids.listingId;
  await db.execute(sql`
    update watches set target_price = 450000, drop_pct = 5, channels = '{telegram,email}', notify_all_time_low = true, notify_restock = true
    where user_id = ${userId}`);

  let m = await step(480000);
  check("1. Primer precio ($480.000): sin avisos (no hay historial)", m.length === 0, m.length);

  m = await step(449990);
  const tg = m.find((x) => x.channel === "telegram")?.text ?? "";
  check("2. Baja a $449.990: UN mensaje por canal (objetivo + % + mínimo agrupados)", m.length === 2, m.map((x) => x.channel));
  check("   El mensaje trae los 3 motivos y el link al historial",
    tg.includes("precio objetivo") && tg.includes("Bajó 6%") && tg.includes("Mínimo histórico") && tg.includes("/producto/"), "\n" + tg);

  m = await step(445000);
  check("3. Sigue bajo el objetivo ($445.000): solo 'mínimo histórico', sin repetir objetivo",
    m.length === 2 && m.every((x) => x.text.includes("Mínimo histórico") && !x.text.includes("precio objetivo")));

  m = await step(470000);
  check("4. Sube sobre el objetivo ($470.000): sin avisos (se rearma)", m.length === 0, m.length);

  m = await step(470000, "out_of_stock");
  check("5. Se agota: sin avisos", m.length === 0);

  m = await step(448000);
  check("6. Vuelve con stock y bajo el objetivo: 'volvió el stock' + objetivo otra vez",
    m.length === 2 && m[0]!.text.includes("Volvió a tener stock") && m[0]!.text.includes("precio objetivo"), m[0]?.text.split("\n").filter((l) => l.startsWith("•")));

  const [{ n } = { n: 0 }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from alerts where user_id = ${userId} and status <> 'sent'`);
  check("7. Todas las alertas quedaron como enviadas", n === 0, { pendientes_o_fallidas: n });

  // Fallo de envío: queda pendiente y reintenta; a los 3 intentos se marca fallida.
  const failing: Transport = { telegram: async () => { throw new Error("chat no existe"); }, email: fake.email };
  sent.length = 0;
  await recordCapture(db, listingId, cap(440000), "manual", userId);
  for (let i = 0; i < 3; i++) await deliverPendingAlerts(db, cfg, failing);
  const [f] = await db.execute<{ failed: number; sent: number }>(sql`
    select count(*) filter (where status = 'failed' and channel = 'telegram')::int as failed,
           count(*) filter (where status = 'sent' and channel = 'email')::int as sent
    from alerts where user_id = ${userId} and created_at > now() - interval '1 minute' and kind = 'all_time_low' and (payload->>'price')::int = 440000`);
  check("8. Si Telegram falla: 3 reintentos y queda 'fallida'; el correo igual sale", f?.failed === 1 && f?.sent === 1, f);
} finally {
  await db.execute(sql`delete from products p where exists (select 1 from watches w where w.product_id = p.id and w.user_id = ${userId})`);
  await db.execute(sql`delete from auth.users where id = ${userId}`);
  await db.$client.end();
}
console.log(ok ? "\n✅ Alertas OK" : "\n❌ Falló");
process.exitCode = ok ? 0 : 1;
