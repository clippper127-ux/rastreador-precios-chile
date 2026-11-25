import { EXTENSION_STORES, formatCLP, MIN_COVERAGE_DAYS_FOR_VERDICT } from "@rastreador/core";
import { ArrowLeft, Clock, ExternalLink, Info, Loader2, Target, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setTargetPrice, unwatch } from "@/app/actions";
import { ManualPriceForm } from "@/components/manual-price-form";
import { PriceBlock } from "@/components/price-block";
import { PriceHistoryChart } from "@/components/price-history-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireUser } from "@/lib/supabase/server";
import { isStale, timeAgo } from "@/lib/time";
import { getProductDetail, type ListingView } from "@/lib/watches";

export const metadata: Metadata = { title: "Producto" };

const STOCK: Record<string, { label: string; variant: "deal" | "danger" | "caution" | "outline" }> = {
  in_stock: { label: "En stock", variant: "deal" },
  preorder: { label: "Preventa", variant: "caution" },
  out_of_stock: { label: "Sin stock", variant: "danger" },
  discontinued: { label: "Descontinuado", variant: "danger" },
  unknown: { label: "Stock desconocido", variant: "outline" },
};

const SOURCE: Record<string, string> = {
  api: "API",
  server: "Servidor",
  extension: "Extensión",
  manual: "Manual",
  pricto: "Pricto",
  feed: "Feed",
  ai: "IA",
};

export default async function ProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevo?: string }>;
}) {
  const { id } = await params;
  const { nuevo } = await searchParams;
  const user = await requireUser(`/producto/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await getProductDetail(user.id, id);
  if (!p) notFound();

  const pending = p.listings.every((l) => l.pending);
  const enoughData = (p.stats?.coverageDays ?? 0) >= MIN_COVERAGE_DAYS_FOR_VERDICT;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/seguimientos"
        className="inline-flex w-fit items-center gap-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Mis seguimientos
      </Link>

      {nuevo && pending && (
        <div role="status" className="flex gap-3 rounded-xl bg-accent p-4 text-sm text-accent-foreground">
          <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin" />
          <p>
            <strong className="font-semibold">Listo, lo estás siguiendo.</strong> El primer precio llega con la próxima
            revisión automática (cada pocas horas). Desde ahí guardamos cada cambio.
          </p>
        </div>
      )}

      {/* Encabezado */}
      <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex gap-4 sm:gap-6">
          <div className="size-24 shrink-0 overflow-hidden rounded-xl border bg-card sm:size-32">
            {p.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- imágenes de tiendas de muchos dominios
              <img src={p.imageUrl} alt="" className="size-full object-contain p-2" />
            )}
          </div>
          <div className="min-w-0">
            {p.brand && <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{p.brand}</p>}
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{p.name}</h1>
            {p.best && !pending && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock aria-hidden className="size-4" />
                Más barato en {p.best.storeName} · actualizado {timeAgo(p.best.lastCheckedAt)}
              </p>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4">
            {pending ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Obteniendo el primer precio…
              </p>
            ) : p.best ? (
              <PriceBlock size="lg" prices={toPrices(p.best)} />
            ) : (
              <Badge variant="danger">Sin stock en las tiendas que sigues</Badge>
            )}
            <dl className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Mínimo histórico</dt>
                <dd className="tabular font-medium">{p.allTimeMin ? formatCLP(p.allTimeMin.price) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Precio habitual</dt>
                <dd className="tabular font-medium">{enoughData && p.stats ? formatCLP(p.stats.median) : "Faltan datos"}</dd>
              </div>
            </dl>
            {!enoughData && !pending && (
              <p className="flex gap-2 text-xs text-muted-foreground">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Con {MIN_COVERAGE_DAYS_FOR_VERDICT} días de historial te diremos si es buen momento para comprar.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Historial */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de precio</CardTitle>
          <CardDescription>Cada línea es una tienda. Solo guardamos un punto cuando el precio o el stock cambian.</CardDescription>
        </CardHeader>
        <CardContent>
          <PriceHistoryChart
            listings={p.listings.map((l) => ({
              id: l.id,
              storeName: l.storeName,
              lastCheckedAt: l.lastCheckedAt?.getTime() ?? null,
              current: { noCard: l.bestNoCard, withCard: l.bestWithCard },
            }))}
            points={p.history}
            allTimeMin={p.allTimeMin?.price}
            targetPrice={p.targetPrice}
          />
        </CardContent>
      </Card>

      {/* Por tienda */}
      <Card>
        <CardHeader>
          <CardTitle>Por tienda</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {p.listings.map((l) => (
            <StoreRow key={l.id} listing={l} />
          ))}
        </CardContent>
      </Card>

      {/* Alerta + dejar de seguir */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target aria-hidden className="size-5 text-brand" />
              Precio objetivo
            </CardTitle>
            <CardDescription>Te avisaremos cuando baje de este precio (avisos en la Fase 4).</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={setTargetPrice.bind(null, p.productId)} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="target">Avisarme bajo</Label>
                <Input
                  id="target"
                  name="target"
                  inputMode="numeric"
                  placeholder={p.bestNoCard ? formatCLP(Math.round((p.bestNoCard * 0.9) / 1000) * 1000) : "$0"}
                  defaultValue={p.targetPrice ? formatCLP(p.targetPrice) : ""}
                />
              </div>
              <Button type="submit">Guardar</Button>
            </form>
          </CardContent>
        </Card>
        <Card className="justify-between">
          <CardHeader>
            <CardTitle>Dejar de seguir</CardTitle>
            <CardDescription>Se borra de tu lista. El historial se conserva si otra persona lo sigue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={unwatch.bind(null, p.productId)}>
              <Button type="submit" variant="outline" className="text-danger">
                <Trash2 aria-hidden />
                Dejar de seguir
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function toPrices(l: ListingView) {
  return {
    priceNormal: l.priceNormal ?? undefined,
    priceOffer: l.priceOffer ?? undefined,
    priceCard: l.priceCard ?? undefined,
    cardName: l.cardName ?? undefined,
  };
}

function StoreRow({ listing: l }: { listing: ListingView }) {
  const stock = STOCK[l.stockStatus] ?? STOCK.unknown!;
  const stale = isStale(l.lastCheckedAt);
  const viaExtension = EXTENSION_STORES.some((s) => s.id === l.storeId);
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium">{l.storeName}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {l.pending ? (
            <span>
              {viaExtension
                ? "Abre la ficha con la extensión instalada para traer el precio"
                : "Esperando primer chequeo"}
            </span>
          ) : (
            <>
              <Badge variant={stock.variant}>{stock.label}</Badge>
              <span className={stale ? "text-caution" : undefined}>
                {stale ? "Último precio conocido " : "Actualizado "}
                {timeAgo(l.lastCheckedAt)}
              </span>
              {l.lastSource && <span>· {SOURCE[l.lastSource] ?? l.lastSource}</span>}
            </>
          )}
          {l.storeStatus === "blocked" && <Badge variant="caution">Tienda bloqueando revisiones</Badge>}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        {!l.pending && <PriceBlock prices={toPrices(l)} className="sm:items-end" />}
        <Button asChild variant="outline" size="sm">
          <a href={l.url} target="_blank" rel="noopener noreferrer">
            {stale ? "Abrir para actualizar" : "Ver en tienda"}
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </div>
    </div>
    {(stale || viaExtension) && <ManualPriceForm listingId={l.id} storeName={l.storeName} />}
    </div>
  );
}
