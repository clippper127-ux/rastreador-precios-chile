"use client";

import { formatCLP, type ResultGroup } from "@rastreador/core";
import { CreditCard, ExternalLink, Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { followGroup } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ResultGroupCard({ group, storeNames }: { group: ResultGroup; storeNames: Record<string, string> }) {
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        group.items
          .filter((i) => i.stockStatus !== "out_of_stock" && i.sellerType !== "third_party")
          .map((i) => i.url)
          .concat(group.items.length === 1 ? [group.items[0]!.url] : []),
      ),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (url: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  const follow = () =>
    start(async () => {
      setError(null);
      const items = group.items.filter((i) => selected.has(i.url));
      const r = await followGroup(items);
      if (r?.error) setError(r.error);
    });

  const showCard = group.bestWithCard != null && group.bestNoCard != null && group.bestWithCard < group.bestNoCard;

  return (
    <article className="flex flex-col rounded-xl border bg-card shadow-soft">
      <div className="flex gap-4 p-4 sm:p-5">
        <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
          {group.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- imágenes de tiendas de muchos dominios
            <img src={group.imageUrl} alt="" loading="lazy" className="size-full object-contain mix-blend-multiply dark:mix-blend-normal" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {group.brand && <p className="text-xs tracking-wide text-muted-foreground uppercase">{group.brand}</p>}
          <h2 className="line-clamp-2 leading-snug font-medium">{group.title}</h2>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tabular text-xl font-semibold tracking-tight">
              {group.bestNoCard != null ? `desde ${formatCLP(group.bestNoCard)}` : "Sin stock"}
            </span>
            {showCard && (
              <span className="flex items-center gap-1 text-sm text-card-price">
                <CreditCard aria-hidden className="size-4" />
                <span className="tabular font-medium">{formatCLP(group.bestWithCard)}</span> con tarjeta
              </span>
            )}
          </div>
        </div>
      </div>

      <ul className="divide-y border-t">
        {group.items.map((i) => {
          const out = i.stockStatus === "out_of_stock";
          return (
            <li key={i.url} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", out && "opacity-60")}>
              <input
                type="checkbox"
                aria-label={`Seguir en ${storeNames[i.storeId] ?? i.storeId}`}
                checked={selected.has(i.url)}
                onChange={() => toggle(i.url)}
                className="size-4 shrink-0 accent-[var(--brand)]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{storeNames[i.storeId] ?? i.storeId}</p>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {i.sellerType === "third_party" && <Badge variant="outline">Vendedor tercero{i.seller ? `: ${i.seller}` : ""}</Badge>}
                  {out && <Badge variant="danger">Sin stock</Badge>}
                </div>
              </div>
              <div className="text-right">
                <p className="tabular text-sm font-semibold">{formatCLP(i.bestNoCard)}</p>
                {i.priceOffer != null && i.priceNormal != null && (
                  <p className="tabular text-xs text-muted-foreground line-through">{formatCLP(i.priceNormal)}</p>
                )}
                {i.priceCard != null && <p className="tabular text-xs text-card-price">{formatCLP(i.priceCard)} tarjeta</p>}
              </div>
              <a
                href={i.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir en ${storeNames[i.storeId] ?? i.storeId}`}
                className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ExternalLink aria-hidden className="size-4" />
              </a>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex flex-wrap items-center gap-3 border-t p-4 sm:px-5">
        <Button size="sm" onClick={follow} disabled={pending || selected.size === 0}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
          {selected.size > 1 ? `Seguir en ${selected.size} tiendas` : "Seguir precio"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
