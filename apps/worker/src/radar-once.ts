import { createDb } from "@rastreador/db";
import { httpTransport } from "@rastreador/db/alerts";
import { notifyDealMatches, pollPublicChannels } from "@rastreador/db/radar";
import { processTelegramUpdates } from "@rastreador/db/telegram";
import { env } from "./env";

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
    const notified = await notifyDealMatches(
      db,
      env.appUrl,
      httpTransport({ appUrl: env.appUrl, telegramToken: env.telegramToken, resendApiKey: env.resendApiKey, resendFrom: env.resendFrom }),
    );
    console.log(`Radar: ${polled.channels} canales, ${polled.newPosts} mensajes nuevos, ${polled.errors} errores · bot: ${bot.processed} · avisos: ${notified}`);
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
