import { anonymize, chatTopics } from "@rastreador/core";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Transport } from "./alerts";
import type { Database } from "./client";
import * as schema from "./schema";

/*
 * Resúmenes de conversación con IA (Gemini, plan gratis; solo si hay LLM_API_KEY).
 * Cuando un tema se calienta en un chat (6+ mensajes sobre lo mismo en 1 h), se le pide a la IA un resumen
 * con los datos concretos (tienda, beneficio, %, tope, condiciones, costos) y se avisa por el bot.
 * A la IA solo va el texto de los mensajes, sin nombres, @usuarios, correos ni teléfonos.
 */

const WINDOW_MS = 3 * 3_600_000; // se miran los mensajes de las últimas 3 h
const REPEAT_MS = 6 * 3_600_000; // el mismo tema en el mismo chat, como máximo cada 6 h
const DAILY_CAP = 8; // avisos de resumen por día
const PER_PASS = 2; // llamadas a la IA por pasada (cuida el límite gratis)

export interface SummaryResult {
  useful: boolean;
  title: string;
  bullets: string[];
}

const PROMPT = `Eres un asistente que resume conversaciones de grupos chilenos de ofertas.
Te paso mensajes de un chat sobre el tema "{TOPIC}". Resume SOLO información concreta y útil para comprar:
tienda o app, producto, beneficio o descuento (%), tope, condiciones, medio de pago, costos o comisiones, si funcionó o no.
Responde SOLO un JSON: {"useful": true|false, "title": "...", "bullets": ["...", "..."]}.
- "title": de qué se habla, máximo 7 palabras (ej. "Tarjeta Mach crédito en Mercado Libre").
- "bullets": 1 a 3 frases cortas (máx. 140 caracteres) con los datos. Si hay opiniones distintas, dilo ("algunos dicen...").
- No inventes nada que no esté en los mensajes. No incluyas nombres de personas.
- "useful": false si es charla sin datos concretos (saludos, bromas, quejas sin información, preguntas sin respuesta).`;

export function llmEnabled(): boolean {
  return !!process.env.LLM_API_KEY?.trim();
}

/** Pide el resumen a Gemini. Devuelve null si falla o la respuesta no es válida. */
export async function summarizeWithLlm(topic: string, messages: string[], fetchImpl: typeof fetch = fetch): Promise<SummaryResult | null> {
  const key = process.env.LLM_API_KEY?.trim();
  if (!key) return null;
  // Alias que Google mantiene apuntando al modelo liviano vigente (los nombres con versión se retiran).
  const model = process.env.LLM_MODEL || "gemini-flash-lite-latest";
  const text = messages.map((m, i) => `${i + 1}. ${anonymize(m).replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: PROMPT.replace("{TOPIC}", topic) }, { text }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 400 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini respondió ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Partial<SummaryResult>;
    const title = String(j.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const bullets = (Array.isArray(j.bullets) ? j.bullets : [])
      .map((b) => String(b).replace(/\s+/g, " ").trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 3);
    if (!title) return null;
    return { useful: j.useful === true && bullets.length > 0, title, bullets };
  } catch {
    return null;
  }
}

/** Busca temas calientes en los chats, los resume y avisa por el bot. Devuelve cuántos avisos mandó. */
export async function summarizeHotTopics(
  db: Database,
  appUrl: string,
  transport: Transport,
  summarize: typeof summarizeWithLlm = summarizeWithLlm,
): Promise<{ summarized: number; sent: number }> {
  if (!llmEnabled() && summarize === summarizeWithLlm) return { summarized: 0, sent: 0 };
  const since = new Date(Date.now() - WINDOW_MS);
  const chats = await db
    .selectDistinct({ id: schema.dealChannels.id, title: schema.dealChannels.title, handle: schema.dealChannels.handle })
    .from(schema.dealChannels)
    .innerJoin(schema.dealSubscriptions, eq(schema.dealSubscriptions.channelId, schema.dealChannels.id))
    .where(and(eq(schema.dealChannels.kind, "group"), eq(schema.dealSubscriptions.enabled, true)));

  let calls = 0;
  let summarized = 0;
  let sent = 0;
  for (const chat of chats) {
    if (calls >= PER_PASS) break;
    const posts = await db
      .select({ id: schema.dealPosts.id, text: schema.dealPosts.text, postedAt: schema.dealPosts.postedAt, externalId: schema.dealPosts.externalId })
      .from(schema.dealPosts)
      .where(and(eq(schema.dealPosts.channelId, chat.id), gte(schema.dealPosts.postedAt, since)));
    // Los avisos automáticos de bots de ofertas no son conversación.
    const talk = posts.filter((p) => !/^🤖/.test(p.text.trim()) && p.text.trim().length > 3);
    const recent = await db
      .select({ topic: schema.dealSummaries.topic })
      .from(schema.dealSummaries)
      .where(and(eq(schema.dealSummaries.channelId, chat.id), gte(schema.dealSummaries.createdAt, new Date(Date.now() - REPEAT_MS))));
    const done = new Set(recent.map((r) => r.topic));

    for (const t of chatTopics(talk, { minMessages: 6, windowMs: 60 * 60_000, max: 2 })) {
      if (done.has(t.word) || calls >= PER_PASS) continue;
      const msgs = t.postIds.map((id) => talk.find((p) => p.id === id)!).filter(Boolean);
      calls++;
      let r: SummaryResult | null = null;
      try {
        r = await summarize(t.word, msgs.slice(-25).map((m) => m.text));
      } catch (err) {
        console.warn("Resumen IA:", (err as Error).message);
        continue;
      }
      if (!r) continue;
      summarized++;
      const [row] = await db
        .insert(schema.dealSummaries)
        .values({
          channelId: chat.id,
          topic: t.word,
          title: r.title,
          bullets: r.bullets,
          useful: r.useful,
          messageCount: msgs.length,
          firstExternalId: msgs[0]?.externalId ?? null,
        })
        .returning();
      if (!row || !r.useful) continue;
      sent += await notifySummary(db, appUrl, transport, row, chat);
    }
  }
  return { summarized, sent };
}

async function notifySummary(
  db: Database,
  appUrl: string,
  transport: Transport,
  row: typeof schema.dealSummaries.$inferSelect,
  chat: { id: string; title: string | null; handle: string | null },
): Promise<number> {
  const [count] = (await db.execute(
    sql`select count(*)::int as n from deal_summaries where notified_at > now() - interval '24 hours'`,
  )) as unknown as { n: number }[];
  if ((count?.n ?? 0) >= DAILY_CAP) return 0;
  const users = await db
    .select({ chat: schema.profiles.telegramChatId })
    .from(schema.dealSubscriptions)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.dealSubscriptions.userId))
    .where(and(eq(schema.dealSubscriptions.channelId, chat.id), eq(schema.dealSubscriptions.enabled, true), isNotNull(schema.profiles.telegramChatId)));
  if (!users.length) return 0;
  const link = chat.handle && row.firstExternalId ? `https://t.me/${chat.handle}/${row.firstExternalId}` : "";
  const text = [
    `💬 ${chat.title ?? "Chat"} — ${row.title}`,
    ...row.bullets.map((b) => `• ${b}`),
    "",
    `(${row.messageCount} mensajes · resumen hecho con IA, revisa antes de decidir)`,
    link ? `Conversación: ${link}` : "",
    `Radar: ${appUrl.replace(/\/+$/, "")}/radar`,
  ]
    .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
    .join("\n");
  let sent = 0;
  for (const u of users) {
    try {
      await transport.telegram(u.chat!, text);
      sent++;
    } catch {
      /* se intenta igual con el resto */
    }
  }
  await db.update(schema.dealSummaries).set({ notifiedAt: new Date() }).where(eq(schema.dealSummaries.id, row.id));
  return sent;
}

/** Resúmenes útiles de los últimos días de los chats que el usuario tiene activos (para la página Radar). */
export async function recentSummaries(db: Database, userId: string, days = 3) {
  const subs = await db
    .select({ id: schema.dealSubscriptions.channelId })
    .from(schema.dealSubscriptions)
    .where(and(eq(schema.dealSubscriptions.userId, userId), eq(schema.dealSubscriptions.enabled, true)));
  if (!subs.length) return [];
  return db
    .select({ s: schema.dealSummaries, title: schema.dealChannels.title, handle: schema.dealChannels.handle })
    .from(schema.dealSummaries)
    .innerJoin(schema.dealChannels, eq(schema.dealChannels.id, schema.dealSummaries.channelId))
    .where(
      and(
        inArray(
          schema.dealSummaries.channelId,
          subs.map((s) => s.id),
        ),
        eq(schema.dealSummaries.useful, true),
        gte(schema.dealSummaries.createdAt, new Date(Date.now() - days * 86_400_000)),
      ),
    )
    .orderBy(sql`${schema.dealSummaries.createdAt} desc`)
    .limit(20);
}
