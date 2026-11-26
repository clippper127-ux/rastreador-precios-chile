import { formatCLP } from "@rastreador/core";
import { ExternalLink, MessagesSquare, Search, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCodeButton } from "@/components/copy-code-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCoupons, NO_STORE } from "@/lib/coupons";
import { requireUser } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cupones" };

export default async function CuponesPage({ searchParams }: { searchParams: Promise<{ tienda?: string; q?: string }> }) {
  const user = await requireUser("/cupones");
  const { tienda, q } = await searchParams;
  const query = q?.trim().slice(0, 40) || undefined;
  const { coupons, stores } = await getCoupons(user.id, { store: tienda, q: query });
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
        <ul className="grid gap-3 md:grid-cols-2">
          {coupons.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-lg font-semibold tracking-wide break-all">{c.code}</p>
                  <p className="mt-0.5 text-sm">
                    {c.store ? (
                      <span className="font-medium">{c.store}</span>
                    ) : (
                      <span className="text-muted-foreground">Tienda no indicada en el mensaje</span>
                    )}
                  </p>
                </div>
                <CopyCodeButton code={c.code} />
              </div>
              {c.benefit && <p className="text-sm">{c.benefit}</p>}
              <div className="flex flex-wrap items-center gap-1.5">
                {c.minPurchase != null && (
                  <Badge variant="outline" className="tabular">
                    Compra mínima {formatCLP(c.minPurchase)}
                  </Badge>
                )}
                {Date.now() - c.lastSeenAt.getTime() > 2 * 86_400_000 && <Badge variant="caution">Puede haber vencido</Badge>}
              </div>
              <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                  <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">{c.channelTitle}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={c.lastSeenAt.toISOString()}>{timeAgo(c.lastSeenAt)}</time>
                </span>
                {c.messageUrl && (
                  <a href={c.messageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                    Ver mensaje <ExternalLink aria-hidden className="size-3" />
                  </a>
                )}
              </footer>
            </li>
          ))}
        </ul>
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
