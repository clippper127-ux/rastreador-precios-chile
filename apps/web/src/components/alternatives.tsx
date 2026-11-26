import { alternativeQuery, groupResults, parseListingUrl, pickAlternatives, type SearchResult } from "@rastreador/core";
import { schema } from "@rastreador/db";
import { Search } from "lucide-react";
import Link from "next/link";
import { ResultGroupCard } from "@/components/result-group-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { parseQuery, searchServerStores, searchSoloTodo } from "@/lib/search";

/**
 * Alternativas equivalentes: busca el tipo de producto (sin marca ni modelo, con la misma medida) y muestra
 * hasta 4 opciones más baratas. Solo sugerencias: nunca cambian lo que sigues. Usa la caché de la búsqueda.
 */
export async function Alternatives({
  name,
  brand,
  urls,
  bestNoCard,
}: {
  name: string;
  brand: string | null;
  urls: string[];
  bestNoCard?: number;
}) {
  const clean = name.replace(/^Pendiente:\s*/, "");
  const qs = alternativeQuery(clean, brand);
  if (!qs || !bestNoCard) return null;
  const q = parseQuery(qs);

  const [stores, solotodo, storeRows] = await Promise.all([searchServerStores(q), searchSoloTodo(q), db().select().from(schema.stores)]);
  const seen = new Set<string>();
  const all: SearchResult[] = [...stores.flatMap((s) => s.results), ...solotodo.results].filter((r) => {
    const p = parseListingUrl(r.url);
    const key = p.ok ? p.url : r.url;
    return !seen.has(key) && !!seen.add(key);
  });
  const alts = pickAlternatives(groupResults(all, q), { name: clean, urls, bestNoCard });
  if (!alts.length) return null;
  const names = Object.fromEntries(storeRows.map((s) => [s.id, s.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alternativas más baratas</CardTitle>
        <CardDescription>
          Productos parecidos (“{qs}”) que hoy cuestan menos. Son solo sugerencias: no cambian lo que sigues. Revisa que
          las características te sirvan antes de comprar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          {alts.map((g) => (
            <div key={g.key} className="flex flex-col gap-1.5">
              {g.maybeSame && (
                <Badge variant="deal" className="self-start">
                  Puede ser el mismo producto en otra tienda
                </Badge>
              )}
              <ResultGroupCard group={g} storeNames={names} />
            </div>
          ))}
        </div>
        <Link href={`/buscar?q=${encodeURIComponent(qs)}`} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand hover:underline">
          <Search aria-hidden className="size-4" />
          Ver todos los resultados de “{qs}”
        </Link>
      </CardContent>
    </Card>
  );
}

export function AlternativesSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Buscando alternativas más baratas">
      <CardHeader>
        <CardTitle>Alternativas más baratas</CardTitle>
        <CardDescription>Buscando productos parecidos…</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        ))}
      </CardContent>
    </Card>
  );
}
