import { createDb, schema } from "@rastreador/db";
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
    await db
      .update(schema.fetchRuns)
      .set({
        finishedAt: sql`now()`,
        listingsChecked: summary.checked,
        snapshotsInserted: summary.snapshots,
        errors: summary.errors,
        summary,
      })
      .where(eq(schema.fetchRuns.id, run!.id));

    // Sin URLs ni nombres de producto en el log: los logs de Actions pueden ser visibles.
    console.log(
      `Pasada ${env.runner}: ${summary.claimed} reclamados, ${summary.checked} revisados, ` +
        `${summary.snapshots} cambios, ${summary.errors} errores` +
        (summary.blockedStores.length ? `, bloqueadas: ${summary.blockedStores.join(", ")}` : ""),
    );
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
