import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Transport } from "./alerts";
import { createDb } from "./client";
import { enableGroupRadar, ingestGroupMessage, notifyDealMatches, subscribeChannel } from "./radar";
import { ensureTracked } from "./track";

/**
 * Prueba del radar de ofertas (solo base de DESARROLLO): usuario temporal, canal público real (@telegram),
 * un "grupo" simulado con mensajes de ofertas y avisos con transporte falso. Borra todo al final.
 *   pnpm --filter @rastreador/db exec tsx src/smoke-radar.ts
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const db = createDb(undefined, { max: 1 });
const userId = randomUUID();
const chatId = -1000000000000 - Math.floor(Math.random() * 1e6);
const sent: string[] = [];
const fake: Transport = { telegram: async (_c, t) => void sent.push(t), email: async (_t, _s, t) => void sent.push(t) };

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
  await db.execute(sql`update profiles set telegram_chat_id = 555, radar_keywords = '{airfryer philips}', radar_price_errors = true where id = ${userId}`);

  // 1. Canal público real
  const sub = await subscribeChannel(db, userId, "https://t.me/s/telegram");
  check("1. Suscribirse a un canal público real (t.me/s/telegram)", "ok" in sub, sub);
  const [{ n } = { n: 0 }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from deal_posts where channel_id = 'c:telegram'`);
  check("   Guarda sus mensajes recientes", n > 0, { mensajes: n });
  const bad = await subscribeChannel(db, userId, "@noexiste_rastreador_x9");
  check("   Canal inexistente o privado → error claro", "error" in bad, bad);

  // 2. Grupo con el bot + producto seguido
  await ensureTracked(db, userId, { url: "https://paris.cl/audifonos-sony-wh-1000xm5-600111999.html", storeId: "paris", storeName: "Paris" }, { title: "Audífonos Sony WH-1000XM5" });
  await enableGroupRadar(db, userId, chatId, "Ofertas de prueba");
  const now = Date.now();
  const msgs = [
    { id: 1, text: "Buenos días a todos 👋", links: [] },
    { id: 2, text: "🔥 Sony WH-1000XM5 a $199.990 en Paris -50%", links: [] },
    { id: 3, text: "Mira esta", links: ["https://www.paris.cl/audifonos-sony-wh-1000xm5-600111999.html?utm_source=tg"] },
    { id: 4, text: "Airfryer Philips 4,1L a $39.990 con cupón HOLA", links: [] },
    { id: 5, text: "🚨 ERROR DE PRECIO 🚨 Smart TV 65 a $99.990", links: [] },
  ];
  for (const m of msgs) await ingestGroupMessage(db, chatId, { id: m.id, postedAt: new Date(now + m.id * 1000), text: m.text, links: m.links });
  const matches = await db.execute<{ ext: number; reasons: string[] }>(sql`
    select p.external_id::int as ext, m.reasons from deal_matches m join deal_posts p on p.id = m.post_id
    where m.user_id = ${userId} order by p.external_id`);
  const byId = Object.fromEntries(matches.map((m) => [m.ext, m.reasons]));
  check("2. Mensaje sin interés → sin coincidencia", !byId[1]);
  check("   Menciona el producto que sigo", byId[2]?.[0]?.includes("Menciona") ?? false, byId[2]);
  check("   Link (con tracking) a la publicación que sigo", byId[3]?.[0]?.includes("Link a") ?? false, byId[3]);
  check("   Palabra clave", byId[4]?.includes('Contiene "airfryer philips"') ?? false, byId[4]);
  check("   Error de precio", byId[5]?.includes("Posible error de precio") ?? false, byId[5]);

  const again = await ingestGroupMessage(db, chatId, { id: 2, postedAt: new Date(), text: msgs[1]!.text, links: [] });
  check("3. El mismo mensaje no se guarda dos veces", again === false);

  const notified = await notifyDealMatches(db, "http://localhost:3000", fake);
  check("4. Avisos enviados por Telegram (uno por coincidencia)", notified === 4 && sent.length === 4, { avisos: notified });
  check("   El aviso trae canal, motivo y precio", !!sent[0]?.includes("Ofertas de prueba") && sent.some((t) => t.includes("$199.990")), "\n" + sent[0]);
  const again2 = await notifyDealMatches(db, "http://localhost:3000", fake);
  check("   No se repiten", again2 === 0);
} finally {
  await db.execute(sql`delete from products p where exists (select 1 from watches w where w.product_id = p.id and w.user_id = ${userId})`);
  await db.execute(sql`delete from auth.users where id = ${userId}`);
  await db.execute(sql`delete from deal_channels c where not exists (select 1 from deal_subscriptions s where s.channel_id = c.id)`);
  await db.$client.end();
}
console.log(ok ? "\n✅ Radar OK" : "\n❌ Falló");
process.exitCode = ok ? 0 : 1;
