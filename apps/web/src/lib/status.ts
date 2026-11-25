import "server-only";
import { adapters, EXTENSION_STORES } from "@rastreador/core";
import { schema } from "@rastreador/db";
import { desc, sql } from "drizzle-orm";
import { db } from "./db";

export interface StoreStatusRow {
  id: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  status: "ok" | "degraded" | "blocked";
  mode: "servidor" | "extensión" | "API" | "—";
  blockedUntil: Date | null;
  backoffLevel: number;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  activeListings: number;
  snapshots24h: number;
  lastSnapshotAt: Date | null;
  notes: string | null;
}

const DB_LIMIT_MB = 500;
const GHA_LIMIT_MIN = 2000;

export async function getSystemStatus() {
  const d = db();
  const stores = await d.select().from(schema.stores);
  const counts = await d.execute<{ store_id: string; active: number; snaps24: number; last_snap: Date | null }>(sql`
    select s.id as store_id,
      (select count(*)::int from listings l where l.store_id = s.id and l.status = 'active') as active,
      (select count(*)::int from price_snapshots ps join listings l on l.id = ps.listing_id
        where l.store_id = s.id and ps.observed_at > now() - interval '24 hours') as snaps24,
      (select max(ps.observed_at) from price_snapshots ps join listings l on l.id = ps.listing_id where l.store_id = s.id) as last_snap
    from stores s`);
  const byStore = new Map(counts.map((c) => [c.store_id, c]));
  const serverIds = new Set(adapters.map((a) => a.id));
  const extIds = new Set(EXTENSION_STORES.map((s) => s.id));

  const storeRows: StoreStatusRow[] = stores
    .map((s) => {
      const c = byStore.get(s.id);
      return {
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        paused: s.paused,
        status: s.status,
        mode: (serverIds.has(s.id) ? "servidor" : extIds.has(s.id) ? "extensión" : s.sourceChain.includes("api") ? "API" : "—") as StoreStatusRow["mode"],
        blockedUntil: s.blockedUntil,
        backoffLevel: s.backoffLevel,
        lastSuccessAt: s.lastSuccessAt,
        lastErrorAt: s.lastErrorAt,
        lastError: s.lastError,
        activeListings: c?.active ?? 0,
        snapshots24h: c?.snaps24 ?? 0,
        lastSnapshotAt: c?.last_snap ? new Date(c.last_snap) : null,
        notes: s.notes,
      };
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));

  const runs = await d.select().from(schema.fetchRuns).orderBy(desc(schema.fetchRuns.startedAt)).limit(12);

  const [usage] = await d.execute<{ db_bytes: number; snapshots: number; listings: number; gha_runs: number; gha_minutes: number }>(sql`
    select pg_database_size(current_database())::bigint as db_bytes,
      (select count(*)::int from price_snapshots) as snapshots,
      (select count(*)::int from listings where status = 'active') as listings,
      (select count(*)::int from fetch_runs where runner = 'gha' and started_at >= date_trunc('month', now())) as gha_runs,
      (select coalesce(sum(ceil(extract(epoch from (coalesce(finished_at, started_at) - started_at)) / 60.0)), 0)::int
         from fetch_runs where runner = 'gha' and started_at >= date_trunc('month', now())) as gha_minutes`);

  const alerts = await d.execute<{ status: string; n: number }>(sql`
    select status::text, count(*)::int as n from alerts where created_at > now() - interval '7 days' group by status`);
  const failedAlerts = await d.execute<{ error: string | null; n: number }>(sql`
    select payload->>'error' as error, count(*)::int as n from alerts
    where status = 'failed' and created_at > now() - interval '7 days' group by 1 order by 2 desc limit 5`);

  const channels = await d.select().from(schema.dealChannels).orderBy(desc(schema.dealChannels.lastCheckedAt)).limit(30);
  const events = await d.select().from(schema.saleEvents).orderBy(schema.saleEvents.startsOn);

  const dbMb = Number(usage?.db_bytes ?? 0) / 1024 / 1024;
  return {
    stores: storeRows,
    runs,
    usage: {
      dbMb,
      dbPct: (dbMb / DB_LIMIT_MB) * 100,
      dbLimitMb: DB_LIMIT_MB,
      snapshots: usage?.snapshots ?? 0,
      listings: usage?.listings ?? 0,
      // Minutos de pasadas del worker registradas este mes (el radar horario no se registra: ~1 min c/u).
      ghaRuns: usage?.gha_runs ?? 0,
      ghaMinutes: usage?.gha_minutes ?? 0,
      ghaLimit: GHA_LIMIT_MIN,
    },
    alerts: Object.fromEntries(alerts.map((a) => [a.status, a.n])) as Record<string, number>,
    failedAlerts,
    channels,
    events: events.filter((e) => e.endsOn.getTime() > Date.now() - 30 * 86_400_000),
    integrations: {
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      email: !!process.env.RESEND_API_KEY,
      healthcheck: !!process.env.HEALTHCHECK_URL,
      mercadolibre: !!process.env.ML_CLIENT_ID,
    },
  };
}
