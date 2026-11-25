import { createDb, schema } from "@rastreador/db";
import { deliverPendingAlerts, httpTransport } from "@rastreador/db/alerts";
import { checkCollectionBudgets } from "@rastreador/db/collections";
import { notifyDealMatches, pollPublicChannels } from "@rastreador/db/radar";
import { soloTodoPass } from "@rastreador/db/solotodo";
import { processTelegramUpdates } from "@rastreador/db/telegram";
import { eq, sql } from "drizzle-orm";
import { env } from "./env";
import { ping } from "./healthcheck";
import { runPass } from "./pass";

/** Una pasada del worker (`pnpm worker:once`). La usa el cron de GitHub Actions y el modo local. */
async function main() {
  await ping("start");
  const db = createDb(env.databaseUrl, { max: 4 });
  const [run] = await db.insert(schema.fetchRuns).values({ runner: env.runner }).returning();

  try {
    const summary = await runPass(db);

    // Tiendas que bloquean al servidor (Falabella, Paris, Ripley, Lider…): precio vía la API pública de SoloTodo.
    let solotodo = { refreshed: 0, changed: 0, resolved: 0, errors: 0 };
    try {
      solotodo = await soloTodoPass(db, {
        fetch: (u, init) =>
          fetch(u, { ...init, headers: { "user-agent": env.userAgent, ...(init?.headers as Record<string, string>) }, signal: AbortSignal.timeout(15_000) }),
      });
    } catch (err) {
      console.warn("SoloTodo no disponible:", (err as Error).message);
    }

    // Mensajes nuevos al bot (vinculaciones, links reenviados) y alertas pendientes.
    let bot = { processed: 0, linked: 0, tracked: 0 };
    if (env.telegramToken) {
      try {
        bot = await processTelegramUpdates(db, { token: env.telegramToken, appUrl: env.appUrl });
      } catch (err) {
        console.warn("Telegram no disponible:", (err as Error).message);
      }
    }
    const deliveryCfg = {
      appUrl: env.appUrl,
      telegramToken: env.telegramToken,
      resendApiKey: env.resendApiKey,
      resendFrom: env.resendFrom,
    };
    const delivery = await deliverPendingAlerts(db, deliveryCfg);

    // Radar de ofertas: canales públicos de Telegram (los grupos llegan por el bot, arriba).
    let radar = { channels: 0, newPosts: 0, errors: 0, notified: 0 };
    try {
      radar = { ...(await pollPublicChannels(db)), notified: 0 };
      radar.notified = await notifyDealMatches(db, env.appUrl, httpTransport(deliveryCfg));
    } catch (err) {
      console.warn("Radar no disponible:", (err as Error).message);
    }
    const listsNotified = await checkCollectionBudgets(db, env.appUrl, httpTransport(deliveryCfg));
    await db
      .update(schema.fetchRuns)
      .set({
        finishedAt: sql`now()`,
        listingsChecked: summary.checked,
        snapshotsInserted: summary.snapshots,
        errors: summary.errors,
        summary: { ...summary, solotodo, bot, delivery, radar, listsNotified },
      })
      .where(eq(schema.fetchRuns.id, run!.id));

    // Sin URLs ni nombres de producto en el log: los logs de Actions pueden ser visibles.
    console.log(
      `Pasada ${env.runner}: ${summary.claimed} reclamados, ${summary.checked} revisados, ` +
        `${summary.snapshots} cambios, ${summary.errors} errores` +
        (summary.blockedStores.length ? `, bloqueadas: ${summary.blockedStores.join(", ")}` : ""),
    );
    console.log(`  solotodo: ${solotodo.refreshed} actualizados, ${solotodo.resolved} enlazados, ${solotodo.changed} cambios, ${solotodo.errors} errores`);
    console.log(`  alertas: ${delivery.sent} enviadas, ${delivery.failed} fallidas · bot: ${bot.processed} mensajes · radar: ${radar.channels} canales, ${radar.newPosts} mensajes nuevos, ${radar.notified} avisos`);
    for (const [store, s] of Object.entries(summary.byStore)) console.log(`  ${store}: ${s.ok} ok, ${s.errors} errores`);
    await ping(summary.errors > 0 && summary.checked === 0 ? "fail" : "success", JSON.stringify(summary));
  } catch (err) {
    await db
      .update(schema.fetchRuns)
      .set({ finishedAt: sql`now()`, errors: 1, summary: { error: (err as Error).message } })
      .where(eq(schema.fetchRuns.id, run!.id));
    await ping("fail", (err as Error).stack);
    throw err;
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
