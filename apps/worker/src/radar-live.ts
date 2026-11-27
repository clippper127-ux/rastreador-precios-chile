import { createDb, schema } from "@rastreador/db";
import { httpTransport } from "@rastreador/db/alerts";
import { ingestReaderChat, notifyDealMatches, pollPublicChannels, readerChatState, scoreHotPosts } from "@rastreador/db/radar";
import { summarizeHotTopics } from "@rastreador/db/summaries";
import { processTelegramUpdates } from "@rastreador/db/telegram";
import { Api } from "telegram";
import { env } from "./env";
import { alertVerification } from "./reader-health";
import { listChats, readChats, readerClient, toRawPosts, type ChatInfo } from "./telegram-reader";

/** Cada cuánto se pregunta por mensajes nuevos (Telegram no "empuja" los de grupos grandes a esta cuenta). */
const POLL_MS = 60_000;

/*
 * Radar CASI EN TIEMPO REAL (en tu PC): pregunta cada minuto por mensajes nuevos en los grupos de la
 * cuenta dedicada y avisa al tiro, mientras el PC esté prendido. (Se probó escuchar los mensajes "en vivo",
 * pero Telegram no los envía a esta cuenta para grupos grandes; una consulta liviana por grupo por minuto sí.) GitHub sigue revisando cada 30 min como respaldo y se
 * salta las pasadas mientras este programa está activo (latido cada minuto en bot_state "radar_live").
 *
 * Usa su PROPIA sesión (TG_SESSION_LIVE, `pnpm telegram:login --live`): Telegram puede cerrar una sesión
 * que se usa desde dos lugares a la vez. Solo lee; no escribe ni marca mensajes como leídos.
 *   pnpm radar:live
 */

const log = (...a: unknown[]) => console.log(new Date().toLocaleString("es-CL"), ...a);

async function main() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH?.trim();
  const session = process.env.TG_SESSION_LIVE?.trim();
  if (!apiId || !apiHash || !session) throw new Error("Falta TG_API_ID, TG_API_HASH o TG_SESSION_LIVE en .env (pnpm telegram:login --live)");

  const db = createDb(env.databaseUrl, { max: 3 });
  const transport = httpTransport({ appUrl: env.appUrl, telegramToken: env.telegramToken, resendApiKey: env.resendApiKey, resendFrom: env.resendFrom });
  const client = readerClient({ apiId, apiHash, session });
  await client.connect();
  if (!(await client.checkAuthorization())) throw new Error("La sesión TG_SESSION_LIVE ya no es válida: vuelve a correr pnpm telegram:login --live");

  let chats = new Map<number, { info: ChatInfo; entity: Api.TypeEntityLike }>();
  const refreshChats = async () => {
    chats = new Map((await listChats(client)).map((c) => [c.info.chatId, c]));
  };
  await refreshChats();
  log(`Vigilando ${chats.size} grupos y canales (cada ${POLL_MS / 1000} s).`);

  // Avisos: se agrupan unos segundos para no recalcular por cada mensaje de una conversación rápida.
  let pending: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  const scheduleNotify = () => {
    if (pending) return;
    pending = setTimeout(async () => {
      pending = undefined;
      if (busy) return scheduleNotify();
      busy = true;
      try {
        const hot = await scoreHotPosts(db);
        const sent = await notifyDealMatches(db, env.appUrl, transport);
        if (hot || sent) log(`destacadas: ${hot} · avisos enviados: ${sent}`);
      } catch (err) {
        log("Error al avisar:", (err as Error).message);
      } finally {
        busy = false;
      }
    }, 4_000);
  };

  let received = 0;
  setInterval(() => {
    log(`${received} mensajes recibidos en la última hora`);
    received = 0;
  }, 3_600_000);

  // Cada minuto: solo los mensajes posteriores al último guardado de cada grupo (una consulta liviana por grupo).
  const poll = async () => {
    for (const { info, entity } of chats.values()) {
      try {
        const state = await readerChatState(db, info.chatId);
        if (!state) continue; // grupo nuevo: lo agrega la relectura (punto de partida sin avisos)
        const msgs = (await client.getMessages(entity, { minId: state.lastPostId, limit: 50 })).filter(
          (m): m is Api.Message => m instanceof Api.Message,
        );
        if (!msgs.length) continue;
        received += msgs.length;
        for (const m of msgs) if (m.mentioned) await alertVerification(db, env.telegramToken, info, m);
        if (process.env.RADAR_DEBUG) log(`${msgs.length} mensajes en ${info.title.slice(0, 30)}`);
        await ingestReaderChat(db, info, toRawPosts(msgs));
        scheduleNotify();
      } catch (err) {
        log(`Error leyendo ${info.title.slice(0, 30)}:`, (err as Error).message.slice(0, 200));
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    setTimeout(poll, POLL_MS);
  };
  void poll();

  // Latido (para que GitHub se salte sus pasadas) y relectura cada 10 min (reacciones, respuestas, mensajes perdidos).
  const beat = () =>
    db
      .insert(schema.botState)
      .values({ id: "radar_live", lastUpdateId: 0, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.botState.id, set: { updatedAt: new Date() } })
      .catch((err: Error) => log("Latido falló:", err.message));
  await beat();
  // Cada minuto: latido + mensajes que le mandas al bot (links reenviados, /start), que GitHub se salta mientras este programa corre.
  setInterval(async () => {
    await beat();
    if (!env.telegramToken) return;
    try {
      const r = await processTelegramUpdates(db, { token: env.telegramToken, appUrl: env.appUrl });
      if (r.processed) scheduleNotify();
    } catch (err) {
      log("Bot:", (err as Error).message);
    }
  }, 60_000);
  setInterval(async () => {
    try {
      await refreshChats();
      const r = await readChats(db, client);
      await pollPublicChannels(db);
      // Temas que se calentaron en los chats → resumen con IA (si hay LLM_API_KEY).
      const talks = await summarizeHotTopics(db, env.appUrl, transport);
      if (talks.sent) log(`resúmenes de conversación enviados: ${talks.sent}`);
      if (r.newPosts || r.errors) log(`relectura: ${r.newPosts} mensajes perdidos recuperados, ${r.errors} errores`);
      scheduleNotify();
    } catch (err) {
      log("Relectura falló:", (err as Error).message);
    }
  }, 10 * 60_000);
}

main().catch((err) => {
  log((err as Error).message);
  // Sale con error: el lanzador de Windows lo vuelve a iniciar al minuto.
  process.exit(1);
});
