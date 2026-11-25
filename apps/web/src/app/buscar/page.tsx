import { EXTENSION_STORES, groupResults, type SearchResult } from "@rastreador/core";
import { schema } from "@rastreador/db";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ResultGroupCard } from "@/components/result-group-card";
import { StoreSearchLinks, type StoreLink } from "@/components/store-search-links";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { capturedResults, parseQuery, searchServerStores } from "@/lib/search";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Resultados" };

export default async function BuscarPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: raw = "" } = await searchParams;
  const q = parseQuery(raw);
  if (!q.tokens.length) redirect("/");

  const user = await getUser();
  const stores = await db().select().from(schema.stores);
  const names = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  const captured = user ? await capturedResults(user.id, q) : [];
  const capturedIds = new Set(captured.map((c) => c.storeId));
  const extIds = new Set(EXTENSION_STORES.map((s) => s.id));

  const links: StoreLink[] = stores
    .filter((s) => s.enabled && s.searchMode === "link" && s.searchUrlTemplate)
    .map((s) => ({
      id: s.id,
      name: s.name,
      // #rq= le dice a la extensión qué buscaste (las tiendas a veces redirigen y pierden la consulta).
      url: `${s.searchUrlTemplate!.replace("{query}", encodeURIComponent(q.raw))}#rq=${encodeURIComponent(q.raw)}`,
      viaExtension: extIds.has(s.id),
      captured: capturedIds.has(s.id),
    }))
    .sort((a, b) => Number(b.viaExtension) - Number(a.viaExtension));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`“${q.raw}”`} description="Resultados agrupados por producto, de menor a mayor precio." />

      <section aria-labelledby="otras" className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
        <h2 id="otras" className="font-medium">Buscar también en</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Estas tiendas no permiten búsquedas automáticas. Ábrelas: con la extensión instalada, sus resultados se suman aquí.
        </p>
        <StoreSearchLinks links={links} />
      </section>

      <Suspense fallback={<ResultsSkeleton />}>
        <Results q={q} captured={captured.flatMap((c) => c.results)} names={names} />
      </Suspense>
    </div>
  );
}

async function Results({
  q,
  captured,
  names,
}: {
  q: ReturnType<typeof parseQuery>;
  captured: SearchResult[];
  names: Record<string, string>;
}) {
  const server = await searchServerStores(q);
  const groups = groupResults([...server.flatMap((s) => s.results), ...captured], q);
  const issues = server.filter((s) => s.status === "limited" || s.status === "error" || s.status === "blocked");

  return (
    <section aria-label="Resultados" className="flex flex-col gap-4">
      {issues.length > 0 && (
        <p className="rounded-xl bg-caution-soft p-3 text-sm text-caution">
          {issues.map((s) => `${s.storeName}: ${s.status === "limited" ? "muchas búsquedas seguidas, intenta en un minuto" : "no respondió"}`).join(" · ")}
        </p>
      )}
      {!groups.length ? (
        <EmptyState
          icon={SearchX}
          title="Sin resultados todavía"
          description="Prueba con otras palabras (marca + modelo funciona mejor) o abre las tiendas de arriba."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {groups.length} {groups.length === 1 ? "producto" : "productos"} ·{" "}
            {groups.filter((g) => g.items.length > 1).length} en más de una tienda
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.slice(0, 40).map((g) => (
              <ResultGroupCard key={g.key} group={g} storeNames={names} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Buscando" className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card p-5 shadow-soft">
          <div className="flex gap-4">
            <Skeleton className="size-20 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-6 w-32" />
            </div>
          </div>
          <Skeleton className="mt-4 h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
