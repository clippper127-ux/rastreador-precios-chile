import { createDb } from "@rastreador/db";
import { httpTransport } from "@rastreador/db/alerts";
import { notifyDealMatches, pollPublicChannels, scoreHotPosts } from "@rastreador/db/radar";
import { summarizeHotTopics } from "@rastreador/db/summaries";
import { processTelegramUpdates } from "@rastreador/db/telegram";
import { env } from "./env";
import { pollReaderAccount, readerConfig } from "./telegram-reader";

/**
 * Pasada liviana del radar de ofertas (`pnpm radar:once`): solo Telegram, sin revisar tiendas.
 * Pensada para correr seguido (GitHub Actions cada hora, o en tu PC cada pocos minutos).
 * Sin URLs ni textos de mensajes en el log: los logs de Actions pueden ser visibles.
 */
async function main() {
  const db = createDb(env.databaseUrl, { max: 2 });
  try {
    let bot = { processed: 0 };
    if (env.telegramToken) bot = await processTelegramUpdates(db, { token: env.telegramToken, appUrl: env.appUrl });
    const polled = await pollPublicChannels(db);
    const cfg = readerConfig();
    let reader = { chats: 0, newPosts: 0, errors: 0 };
    if (cfg) {
      try {
        reader = await pollReaderAccount(db, cfg);
      } catch (err) {
        console.error("Cuenta dedicada de Telegram:", (err as Error).message);
        reader.errors++;
      }
    }
    const hot = await scoreHotPosts(db);
    const transport = httpTransport({ appUrl: env.appUrl, telegramToken: env.telegramToken, resendApiKey: env.resendApiKey, resendFrom: env.resendFrom });
    const talks = await summarizeHotTopics(db, env.appUrl, transport).catch((err: Error) => {
      console.error("Resúmenes:", err.message);
      return { summarized: 0, sent: 0 };
    });
    const notified = await notifyDealMatches(
      db,
      env.appUrl,
      httpTransport({ appUrl: env.appUrl, telegramToken: env.telegramToken, resendApiKey: env.resendApiKey, resendFrom: env.resendFrom }),
    );
    console.log(`Radar: ${polled.channels} canales, ${polled.newPosts} mensajes nuevos, ${polled.errors} errores · cuenta dedicada: ${reader.chats} grupos, ${reader.newPosts} mensajes nuevos, ${reader.errors} errores · bot: ${bot.processed} · destacadas: ${hot} · resúmenes: ${talks.summarized} (${talks.sent} avisados) · avisos: ${notified}`);
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
