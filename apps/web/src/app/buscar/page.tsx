import { Construction } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Resultados" };

export default async function BuscarPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  return (
    <>
      <PageHeader title={q ? `“${q}”` : "Buscar"} description="Resultados agrupados por producto." />
      <EmptyState
        icon={Construction}
        title="La búsqueda llega en la Fase 5"
        description="Primero conectamos las tiendas (Fase 1) y el seguimiento (Fase 2). Esta pantalla ya tiene su lugar."
      >
        <Button asChild variant="outline">
          <Link href="/">Volver</Link>
        </Button>
      </EmptyState>
    </>
  );
}
