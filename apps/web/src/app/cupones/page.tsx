import { formatCLP } from "@rastreador/core";
import { Ban, CalendarClock, ExternalLink, MessagesSquare, RotateCcw, Search, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCodeButton } from "@/components/copy-code-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setCouponAvailable } from "@/app/coupon-actions";
import { getCoupons, NO_STORE, type CouponRow } from "@/lib/coupons";
import { requireUser } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cupones" };

export default async function CuponesPage({ searchParams }: { searchParams: Promise<{ tienda?: string; q?: string }> }) {
  const user = await requireUser("/cupones");
  const { tienda, q } = await searchParams;
  const query = q?.trim().slice(0, 40) || undefined;
  const { coupons, stores } = await getCoupons(user.id, { store: tienda, q: query });
  const available = coupons.filter((c) => !c.expiredAt);
  const expired = coupons.filter((c) => c.expiredAt);
  const href = (t?: string) => {
    const p = new URLSearchParams();
    if (t) p.set("tienda", t);
    if (query) p.set("q", query);
    const s = p.toString();
    return s ? `/cupones?${s}` : "/cupones";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cupones"
        description="Códigos de descuento que aparecieron en tus canales y grupos del Radar en los últimos 14 días. Revisa las condiciones en el mensaje original: muchos duran solo un día."
      />

      <form action="/cupones" className="flex gap-2" role="search">
        {tienda && <input type="hidden" name="tienda" value={tienda} />}
        <label htmlFor="q" className="sr-only">
          Buscar cupón
        </label>
        <Input id="q" name="q" defaultValue={query} placeholder="Código, tienda o categoría (ej: mascotas)" autoComplete="off" />
        <Button type="submit" variant="outline">
          <Search aria-hidden />
          Buscar
        </Button>
      </form>

      {stores.length > 0 && (
        <nav aria-label="Filtrar por tienda" className="-mx-1 flex flex-wrap gap-1.5">
          <FilterChip href={href()} active={!tienda} label="Todas" />
          {stores.map((s) => (
            <FilterChip
              key={s.name}
              href={href(s.name)}
              active={tienda === s.name}
              label={`${s.name === NO_STORE ? "Sin tienda" : s.name} (${s.count})`}
            />
          ))}
        </nav>
      )}

      {!coupons.length ? (
        <EmptyState
          icon={Ticket}
          title={tienda || query ? "No hay cupones con ese filtro" : "Aún no hay cupones"}
          description={
            tienda || query
              ? "Prueba con otra tienda o borra la búsqueda."
              : "Aparecen solos cuando un canal o grupo de tu Radar publica un código de descuento."
          }
        />
      ) : (
        <>
          {available.length > 0 ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {available.map((c) => (
                <CouponCard key={c.id} c={c} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Todos los cupones de este filtro están marcados como no disponibles.</p>
          )}
          {expired.length > 0 && (
            <details className="rounded-xl border bg-muted/40 p-3">
              <summary className="cursor-pointer text-sm font-medium">No disponibles ({expired.length})</summary>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {expired.map((c) => (
                  <CouponCard key={c.id} c={c} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Los códigos se detectan automáticamente en los mensajes: si alguno no es un cupón real o la tienda no corresponde, revisa el
        mensaje original. ¿Faltan grupos? Agrégalos en <Link href="/radar" className="text-brand underline-offset-4 hover:underline">Radar</Link>.
      </p>
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:outline-none",
        active ? "border-brand bg-brand/10 text-brand" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

/** Fecha y hora de Chile, ej. "26 nov, 14:32". */
const fmtDate = (d: Date) =>
  d.toLocaleString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function CouponCard({ c }: { c: CouponRow }) {
  const dead = !!c.expiredAt;
  return (
    <li className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-soft", dead && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-mono text-lg font-semibold tracking-wide break-all", dead && "line-through")}>{c.code}</p>
          <p className="mt-0.5 text-sm">
            {c.store ? <span className="font-medium">{c.store}</span> : <span className="text-muted-foreground">Tienda no indicada en el mensaje</span>}
          </p>
        </div>
        {!dead && <CopyCodeButton code={c.code} />}
      </div>
      {c.benefit && <p className="text-sm">{c.benefit}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {dead && (
          <Badge variant="danger">
            <Ban aria-hidden />
            No disponible · {c.expiredReason === "grupo" ? "lo dijeron en el grupo" : "marcado a mano"}
          </Badge>
        )}
        {c.minPurchase != null && (
          <Badge variant="outline" className="tabular">
            Compra mínima {formatCLP(c.minPurchase)}
          </Badge>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock aria-hidden className="size-3.5 shrink-0" />
        <span>
          Capturado el <time dateTime={c.firstSeenAt.toISOString()}>{fmtDate(c.firstSeenAt)}</time>
          {c.lastSeenAt.getTime() - c.firstSeenAt.getTime() > 3_600_000 && (
            <>
              {" "}
              · visto de nuevo <time dateTime={c.lastSeenAt.toISOString()}>{timeAgo(c.lastSeenAt)}</time>
            </>
          )}
        </span>
      </p>
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{c.channelTitle}</span>
        </span>
        <span className="flex items-center gap-3">
          {c.messageUrl && (
            <a href={c.messageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              Ver mensaje <ExternalLink aria-hidden className="size-3" />
            </a>
          )}
          <form action={setCouponAvailable.bind(null, c.id, dead)}>
            <Button type="submit" size="sm" variant="ghost" className={dead ? undefined : "text-danger"}>
              {dead ? <RotateCcw aria-hidden /> : <Ban aria-hidden />}
              {dead ? "Sigue funcionando" : "Ya no funciona"}
            </Button>
          </form>
        </span>
      </footer>
    </li>
  );
}
