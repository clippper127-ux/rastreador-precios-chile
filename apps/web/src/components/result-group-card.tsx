"use client";

import { formatCLP, formatUnitPrice, measureLabel, parseListingUrl, unitPriceFromTitle, type ResultGroup } from "@rastreador/core";
import { CreditCard, ExternalLink, Link2, Loader2, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { followGroup } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  // Links agregados a mano (otra tienda donde viste el mismo producto).
  const [extra, setExtra] = useState<{ url: string; storeId: string; storeName: string; viaExtension: boolean }[]>([]);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const addLink = () => {
    const p = parseListingUrl(link.trim());
    if (!p.ok) {
      setLinkError(
        p.reason === "unsupported"
          ? /meli\.la|mercadolibre\.com\/sec/i.test(link)
            ? "Es un link corto: ábrelo y copia la dirección completa de la ficha (o pégalo en Mis seguimientos)."
            : "Todavía no seguimos esa tienda."
          : p.reason === "not_product"
            ? `Ese link de ${p.storeName ?? "la tienda"} no es la ficha de un producto: abre el producto y copia su link.`
            : "Eso no parece un link válido.",
      );
      return;
    }
    if ([...group.items, ...extra].some((i) => i.url === p.url)) {
      setLinkError("Ese link ya está en la lista.");
      return;
    }
    setExtra((e) => [...e, { url: p.url, storeId: p.storeId, storeName: p.storeName, viaExtension: p.mode === "extension" }]);
    setSelected((s) => new Set(s).add(p.url));
    setLink("");
    setLinkError(null);
    setAdding(false);
  };
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
      const items = [
        ...group.items.filter((i) => selected.has(i.url)),
        ...extra.filter((e) => selected.has(e.url)).map((e) => ({ url: e.url, title: group.title, brand: group.brand })),
      ];
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
          {group.variant.length > 0 && (
            <p className="mt-1.5 flex flex-wrap gap-1" aria-label="Versión">
              {group.variant.map((v) => (
                <Badge key={v} variant="outline" className="tabular">
                  {measureLabel(v)}
                </Badge>
              ))}
            </p>
          )}
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
                  {i.solotodoEntityId != null && <span className="text-xs text-muted-foreground">vía SoloTodo</span>}
                </div>
              </div>
              <div className="text-right">
                <p className="tabular text-sm font-semibold">{formatCLP(i.bestNoCard)}</p>
                {unitOf(i.title ?? group.title, i.bestNoCard) && (
                  <p className="tabular text-xs text-muted-foreground">{unitOf(i.title ?? group.title, i.bestNoCard)}</p>
                )}
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
        {extra.map((e) => (
          <li key={e.url} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <input
              type="checkbox"
              aria-label={`Seguir en ${e.storeName}`}
              checked={selected.has(e.url)}
              onChange={() => toggle(e.url)}
              className="size-4 shrink-0 accent-[var(--brand)]"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{e.storeName}</p>
              <p className="text-xs text-muted-foreground">
                Agregado por ti · {e.viaExtension ? "el precio llega al abrir la ficha con la extensión" : "el precio llega con la próxima revisión"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setExtra((x) => x.filter((y) => y.url !== e.url));
                setSelected((s) => {
                  const n = new Set(s);
                  n.delete(e.url);
                  return n;
                });
              }}
              aria-label={`Quitar ${e.storeName}`}
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t px-4 py-3 sm:px-5">
        {adding ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor={`link-${group.key}`} className="sr-only">
                Link de otra tienda
              </label>
              <Input
                id={`link-${group.key}`}
                type="url"
                inputMode="url"
                autoFocus
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setLinkError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                  }
                }}
                placeholder="Pega el link de la ficha en otra tienda"
                aria-invalid={linkError ? true : undefined}
                className="h-10 flex-1"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={addLink} disabled={!link.trim()}>
                  Agregar
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
            {linkError && (
              <p role="alert" className="text-sm text-danger">
                {linkError}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <Link2 aria-hidden className="size-4" />
            Agregar link de otra tienda
          </button>
        )}
      </div>

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

function unitOf(title: string, price: number | undefined): string | undefined {
  const u = unitPriceFromTitle(title, price);
  return u && formatUnitPrice(u);
}
