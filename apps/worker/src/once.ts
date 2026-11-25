import { createDb, schema } from "@rastreador/db";
import { deliverPendingAlerts } from "@rastreador/db/alerts";
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

    // Mensajes nuevos al bot (vinculaciones, links reenviados) y alertas pendientes.
    let bot = { processed: 0, linked: 0, tracked: 0 };
    if (env.telegramToken) {
      try {
        bot = await processTelegramUpdates(db, { token: env.telegramToken, appUrl: env.appUrl });
      } catch (err) {
        console.warn("Telegram no disponible:", (err as Error).message);
      }
    }
    const delivery = await deliverPendingAlerts(db, {
      appUrl: env.appUrl,
      telegramToken: env.telegramToken,
      resendApiKey: env.resendApiKey,
      resendFrom: env.resendFrom,
    });
    await db
      .update(schema.fetchRuns)
      .set({
        finishedAt: sql`now()`,
        listingsChecked: summary.checked,
        snapshotsInserted: summary.snapshots,
        errors: summary.errors,
        summary: { ...summary, bot, delivery },
      })
      .where(eq(schema.fetchRuns.id, run!.id));

    // Sin URLs ni nombres de producto en el log: los logs de Actions pueden ser visibles.
    console.log(
      `Pasada ${env.runner}: ${summary.claimed} reclamados, ${summary.checked} revisados, ` +
        `${summary.snapshots} cambios, ${summary.errors} errores` +
        (summary.blockedStores.length ? `, bloqueadas: ${summary.blockedStores.join(", ")}` : ""),
    );
    console.log(`  alertas: ${delivery.sent} enviadas, ${delivery.failed} fallidas · bot: ${bot.processed} mensajes`);
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
