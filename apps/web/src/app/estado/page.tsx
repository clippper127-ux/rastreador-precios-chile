import { schema } from "@rastreador/db";
import { eq } from "drizzle-orm";
import { Activity, CheckCircle2, CircleSlash, Database, Gauge, Radio, ShieldAlert, Timer, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { resetStoreBackoff, setStorePaused } from "@/app/status-actions";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { getSystemStatus, type StoreStatusRow } from "@/lib/status";
import { requireUser } from "@/lib/supabase/server";
import { isStale, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Estado del sistema" };

function Meter({ label, value, max, unit, icon: Icon }: { label: string; value: number; max: number; unit: string; icon: typeof Gauge }) {
  const pct = Math.min(100, (value / max) * 100);
  const tone = pct >= 80 ? "bg-danger" : pct >= 60 ? "bg-caution" : "bg-deal";
  return (
    <div className="rounded-xl border bg-card p-4 shadow-soft">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon aria-hidden className="size-4" /> {label}
      </p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
        {value.toLocaleString("es-CL", { maximumFractionDigits: 1 })}
        <span className="text-sm font-normal text-muted-foreground">
          {" "}
          / {max.toLocaleString("es-CL")} {unit}
        </span>
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(pct, 1.5)}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: StoreStatusRow }) {
  if (!s.enabled) return <Badge variant="outline"><CircleSlash aria-hidden /> Desactivada</Badge>;
  if (s.paused) return <Badge variant="outline">Pausada</Badge>;
  if (s.status === "blocked") return <Badge variant="danger"><ShieldAlert aria-hidden /> Bloqueada</Badge>;
  if (s.status === "degraded") return <Badge variant="caution"><TriangleAlert aria-hidden /> Con errores</Badge>;
  return <Badge variant="deal"><CheckCircle2 aria-hidden /> OK</Badge>;
}

export default async function EstadoPage() {
  const user = await requireUser("/estado");
  const me = await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id), columns: { isAdmin: true } });
  const isAdmin = !!me?.isAdmin;
  const s = await getSystemStatus();
  const lastRun = s.runs[0];
  const workerStale = !lastRun || isStale(lastRun.startedAt, 8);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Estado del sistema" description="Tiendas, worker, alertas, radar y uso de los planes gratis." />

      {workerStale && (
        <p role="alert" className="flex gap-2 rounded-xl bg-caution-soft p-4 text-sm text-caution">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {lastRun
            ? `La última pasada del worker fue ${timeAgo(lastRun.startedAt)}. Revisa el workflow "Worker" en GitHub Actions (o corre pnpm worker:once).`
            : "El worker todavía no ha corrido. Corre pnpm worker:once o activa el workflow en GitHub Actions."}
        </p>
      )}

      <section aria-label="Uso de planes gratis" className="grid gap-4 sm:grid-cols-3">
        <Meter label="Base de datos (Supabase)" value={s.usage.dbMb} max={s.usage.dbLimitMb} unit="MB" icon={Database} />
        <Meter label="Minutos de Actions este mes (worker)" value={s.usage.ghaMinutes} max={s.usage.ghaLimit} unit="min" icon={Timer} />
        <div className="rounded-xl border bg-card p-4 shadow-soft">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity aria-hidden className="size-4" /> Datos
          </p>
          <p className="tabular mt-1 text-2xl font-semibold tracking-tight">{s.usage.listings.toLocaleString("es-CL")}</p>
          <p className="text-sm text-muted-foreground">publicaciones activas · {s.usage.snapshots.toLocaleString("es-CL")} precios guardados</p>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Tiendas</CardTitle>
          <CardDescription>
            Bloqueada = respondió 403/429 o desafío anti-bot; el worker espera cada vez más antes de reintentar (máx. 48 h).
            {!isAdmin && " Para pausar o reintentar necesitas ser administrador (pnpm db:admin <tu correo>)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium sm:px-6">Tienda</th>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                <th scope="col" className="px-3 py-2 font-medium">Fuente</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Seguidas</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Precios 24 h</th>
                <th scope="col" className="px-3 py-2 font-medium">Último dato</th>
                {isAdmin && <th scope="col" className="px-4 py-2 font-medium sm:px-6"><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {s.stores.map((st) => (
                <tr key={st.id} className={cn(!st.enabled && "text-muted-foreground")}>
                  <td className="px-4 py-3 sm:px-6">
                    <p className="font-medium">{st.name}</p>
                    {st.lastError && st.status !== "ok" && (
                      <p className="mt-0.5 max-w-[260px] truncate text-xs text-danger" title={st.lastError}>
                        {st.lastError}
                      </p>
                    )}
                    {st.blockedUntil && st.blockedUntil > new Date() && (
                      <p className="text-xs text-muted-foreground">Reintenta {timeAgo(st.blockedUntil)}</p>
                    )}
                  </td>
                  <td className="px-3 py-3"><StatusBadge s={st} /></td>
                  <td className="px-3 py-3 capitalize">{st.mode}</td>
                  <td className="tabular px-3 py-3 text-right">{st.activeListings}</td>
                  <td className="tabular px-3 py-3 text-right">{st.snapshots24h}</td>
                  <td className="px-3 py-3 text-xs">{st.lastSnapshotAt ? timeAgo(st.lastSnapshotAt) : "—"}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 sm:px-6">
                      <div className="flex justify-end gap-1">
                        {st.status === "blocked" && (
                          <form action={resetStoreBackoff.bind(null, st.id)}>
                            <Button size="sm" variant="outline" type="submit">Reintentar</Button>
                          </form>
                        )}
                        {st.enabled && (
                          <form action={setStorePaused.bind(null, st.id, !st.paused)}>
                            <Button size="sm" variant="ghost" type="submit">{st.paused ? "Reanudar" : "Pausar"}</Button>
                          </form>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Últimas pasadas del worker</CardTitle>
          </CardHeader>
          <CardContent>
            {!s.runs.length ? (
              <p className="text-sm text-muted-foreground">Todavía no hay pasadas.</p>
            ) : (
              <ul className="flex flex-col divide-y text-sm">
                {s.runs.map((r) => {
                  const secs = r.finishedAt ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000) : null;
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex items-center gap-2">
                        <Badge variant={r.errors > 0 ? "caution" : "outline"}>{r.runner === "gha" ? "Actions" : "PC"}</Badge>
                        {timeAgo(r.startedAt)}
                      </span>
                      <span className="tabular text-xs text-muted-foreground">
                        {r.listingsChecked} revisados · {r.snapshotsInserted} cambios · {r.errors} errores
                        {secs != null && ` · ${secs} s`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Avisos e integraciones</CardTitle>
            <CardDescription>Últimos 7 días.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="deal">{s.alerts.sent ?? 0} enviadas</Badge>
              <Badge variant="caution">{s.alerts.pending ?? 0} pendientes</Badge>
              <Badge variant="danger">{s.alerts.failed ?? 0} fallidas</Badge>
            </div>
            {s.failedAlerts.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-danger">
                {s.failedAlerts.map((f) => (
                  <li key={f.error ?? "?"}>{f.error ?? "Error desconocido"} ({f.n})</li>
                ))}
              </ul>
            )}
            <ul className="grid grid-cols-2 gap-2">
              {(
                [
                  ["Telegram", s.integrations.telegram],
                  ["Correo (Resend)", s.integrations.email],
                  ["Healthchecks.io", s.integrations.healthcheck],
                  ["Mercado Libre", s.integrations.mercadolibre],
                ] as const
              ).map(([name, ok]) => (
                <li key={name} className="flex items-center gap-2">
                  {ok ? <CheckCircle2 aria-hidden className="size-4 text-deal" /> : <CircleSlash aria-hidden className="size-4 text-muted-foreground" />}
                  <span className={ok ? undefined : "text-muted-foreground"}>{name}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {s.channels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio aria-hidden className="size-5" /> Radar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y text-sm">
              {s.channels.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">{c.title ?? c.id}</span>
                  <span className={cn("shrink-0 text-xs", c.lastError ? "text-danger" : "text-muted-foreground")}>
                    {c.lastError ? `Error: ${c.lastError}` : `Revisado ${timeAgo(c.lastCheckedAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
