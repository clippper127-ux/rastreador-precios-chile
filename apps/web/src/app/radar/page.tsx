import { formatCLP } from "@rastreador/core";
import { AlertTriangle, ExternalLink, MessagesSquare, Radio, Tag, Trash2, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { removeSource, toggleSource } from "@/app/radar-actions";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { AddChannelForm, CheckNowButton, RadarPrefsForm } from "@/components/radar-forms";
import { TrackLinkButton } from "@/components/track-link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRadar } from "@/lib/radar";
import { requireUser } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Radar de ofertas" };

const FLAG_LABEL: Record<string, string> = {
  error_precio: "Posible error de precio",
  cupon: "Cupón",
  liquidacion: "Liquidación",
  envio_gratis: "Envío gratis",
  descuento: "Descuento",
};

export default async function RadarPage() {
  const user = await requireUser("/radar");
  const r = await getRadar(user.id);
  const matched = r.posts.filter((p) => p.reasons);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Radar de ofertas"
        description="Lee canales y grupos de Telegram y te avisa cuando aparece algo que te interesa."
        actions={r.sources.length ? <CheckNowButton /> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Mensajes */}
        <section aria-labelledby="mensajes" className="order-2 flex flex-col gap-3 lg:order-1">
          {/* Conversaciones resumidas con IA */}
          <h2 id="conversaciones" className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            De qué se está hablando
          </h2>
          {!r.aiEnabled ? (
            <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
              Los resúmenes de conversación usan IA (Gemini, gratis). Se activan al poner la clave en <code>LLM_API_KEY</code>.
            </p>
          ) : !r.summaries.length ? (
            <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
              Cuando un tema se calienta en un chat (6 o más mensajes sobre lo mismo en una hora), aparece aquí resumido y te llega por el bot.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {r.summaries.map((s) => (
                <li key={s.id} className="rounded-xl border bg-card p-4 shadow-soft">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <MessagesSquare aria-hidden className="size-3.5" />
                      {s.chat}
                    </span>
                    <time dateTime={s.createdAt.toISOString()}>{timeAgo(s.createdAt)}</time>
                  </p>
                  <h3 className="mt-2 font-medium">{s.title}</h3>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                    {s.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <p className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <span>{s.messageCount} mensajes · resumen hecho con IA, revisa antes de decidir</span>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                        Ver conversación <ExternalLink aria-hidden className="size-3" />
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <h2 id="mensajes" className="mt-4 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Últimos 7 días {matched.length > 0 && `· ${matched.length} para ti`}
          </h2>
          {!r.posts.length ? (
            <EmptyState
              icon={Radio}
              title={r.sources.length ? "Sin mensajes todavía" : "Agrega tu primer canal"}
              description={
                r.sources.length
                  ? "Los canales se revisan cada hora. También puedes tocar “Revisar ahora”."
                  : "Pega el @nombre de un canal público de ofertas, o agrega el bot a un grupo."
              }
            />
          ) : (
            r.posts.map((p) => (
              <article
                key={p.id}
                className={cn("rounded-xl border bg-card p-4 shadow-soft", p.reasons && "border-deal/50 ring-1 ring-deal/20")}
              >
                <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <MessagesSquare aria-hidden className="size-3.5" />
                    {p.channelTitle}
                  </span>
                  <span className="flex items-center gap-2">
                    <time dateTime={p.postedAt.toISOString()}>{timeAgo(p.postedAt)}</time>
                    {p.channelHandle && (
                      <a
                        href={`https://t.me/${p.channelHandle}/${p.externalId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        Ver en Telegram <ExternalLink aria-hidden className="size-3" />
                      </a>
                    )}
                  </span>
                </header>
                {p.reasons && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {p.reasons.map((x) => (
                      <li key={x}>
                        <Badge variant="deal">{x}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 line-clamp-6 text-sm whitespace-pre-line">{p.text || "(sin texto)"}</p>
                {(p.prices.length > 0 || p.flags.length > 0 || p.discountPct || p.categories.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.flags.map((f) => (
                      <Badge key={f} variant={f === "error_precio" ? "caution" : "outline"}>
                        {f === "error_precio" && <AlertTriangle aria-hidden />}
                        {FLAG_LABEL[f] ?? f}
                      </Badge>
                    ))}
                    {p.categories.map((c) => (
                      <Badge key={c} variant="outline" className="text-muted-foreground">
                        {c}
                      </Badge>
                    ))}
                    {p.discountPct != null && <Badge variant="outline">−{p.discountPct}%</Badge>}
                    {p.prices.slice(0, 3).map((x) => (
                      <Badge key={x} variant="outline" className="tabular">
                        <Tag aria-hidden /> {formatCLP(x)}
                      </Badge>
                    ))}
                  </div>
                )}
                {p.storeLinks.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
                    {p.storeLinks.map((l) => (
                      <li key={l.url} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:text-brand">
                          {l.storeName} <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                        </a>
                        <TrackLinkButton url={l.url} />
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))
          )}
        </section>

        {/* Fuentes y preferencias */}
        <aside className="order-1 flex flex-col gap-4 lg:order-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fuentes</CardTitle>
              <CardDescription>Canales públicos y grupos con el bot.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <AddChannelForm />
              {r.sources.length > 0 && (
                <ul className="flex flex-col divide-y rounded-xl border">
                  {r.sources.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      {s.kind === "group" ? (
                        <Users aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Radio aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm font-medium", !s.enabled && "text-muted-foreground line-through")}>{s.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.lastError ? <span className="text-danger">No se pudo leer</span> : `Revisado ${timeAgo(s.lastCheckedAt)}`}
                        </p>
                      </div>
                      <form action={toggleSource.bind(null, s.id, !s.enabled)}>
                        <Button size="sm" variant="ghost" type="submit">
                          {s.enabled ? "Pausar" : "Activar"}
                        </Button>
                      </form>
                      <form action={removeSource.bind(null, s.id)}>
                        <Button size="icon-sm" variant="ghost" type="submit" aria-label={`Quitar ${s.title}`}>
                          <Trash2 aria-hidden className="size-4" />
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <details className="rounded-xl bg-muted/60 p-3 text-sm">
                <summary className="cursor-pointer font-medium">¿Y los grupos?</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>
                    Vincula Telegram en <Link href="/configuracion" className="text-brand underline-offset-4 hover:underline">Ajustes</Link>
                    {r.telegramLinked && " (✓ listo)"}.
                  </li>
                  <li>En @BotFather: /setprivacy → elige tu bot → Disable (para que lea los mensajes).</li>
                  <li>Agrega el bot al grupo y escribe <code>/radar</code> en el grupo.</li>
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">
                  Solo funciona en grupos que permiten agregar bots. Para grupos privados que no lo permiten existe la opción de una cuenta dedicada (ver README).
                </p>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Qué avisarte</CardTitle>
            </CardHeader>
            <CardContent>
              <RadarPrefsForm keywords={r.keywords} priceErrors={r.priceErrors} hotLevel={r.hotLevel}
                hotWords={r.hotWords}
                catsInclude={r.catsInclude}
                catsExclude={r.catsExclude}
                blockWords={r.blockWords}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
