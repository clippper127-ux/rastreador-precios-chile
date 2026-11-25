import { LayoutGrid, PackagePlus, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TrackUrlForm } from "@/components/track-url-form";
import { Button } from "@/components/ui/button";
import { WatchCard } from "@/components/watch-card";
import { requireUser } from "@/lib/supabase/server";
import { listWatchCards } from "@/lib/watches";

export const metadata: Metadata = { title: "Mis seguimientos" };

export default async function SeguimientosPage() {
  const user = await requireUser("/seguimientos");
  const cards = await listWatchCards(user.id);

  if (!cards.length) {
    return (
      <>
        <PageHeader title="Mis seguimientos" description="Precio más bajo actual, tienda y variación de cada producto." />
        <EmptyState
          icon={LayoutGrid}
          title="Todavía no sigues nada"
          description="Pega el link de la ficha de un producto, búscalo por nombre o crea uno con links de varias tiendas."
        >
          <div className="mb-2 basis-full">
            <div className="mx-auto max-w-xl text-left">
              <TrackUrlForm />
            </div>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <Search aria-hidden />
              Buscar por nombre
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/seguimientos/nuevo">
              <PackagePlus aria-hidden />
              Crear producto a mano
            </Link>
          </Button>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Mis seguimientos"
        description={`${cards.length} ${cards.length === 1 ? "producto" : "productos"}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/listas">Mis listas</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/seguimientos/nuevo">
                <PackagePlus aria-hidden />
                Producto a mano
              </Link>
            </Button>
            <Button asChild>
              <Link href="/">
                <Plus aria-hidden />
                Buscar otro
              </Link>
            </Button>
          </>
        }
      />
      <section aria-label="Seguir con un link" className="mb-6 rounded-xl border bg-card p-4 shadow-soft sm:p-5">
        <TrackUrlForm />
      </section>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <WatchCard key={card.watchId} card={card} />
        ))}
      </div>
    </>
  );
}
