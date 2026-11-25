import { formatCLP } from "@rastreador/core";
import { ArrowLeft, PackageOpen, Trash2, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteList, removeFromList } from "@/app/list-actions";
import { BudgetBar } from "@/components/budget-bar";
import { EmptyState } from "@/components/empty-state";
import { EditListForm } from "@/components/list-forms";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WatchCard } from "@/components/watch-card";
import { getList } from "@/lib/lists";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lista" };

export default async function ListaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/listas/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getList(user.id, id);
  if (!data) notFound();
  const { list, cards, total } = data;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/listas" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Listas
      </Link>
      <PageHeader
        title={list.name}
        description={
          total
            ? `Total ${formatCLP(total.total)}${list.budget ? ` de ${formatCLP(list.budget)} de presupuesto` : ""} · ${total.items} productos`
            : undefined
        }
        actions={
          <form action={deleteList.bind(null, list.id)}>
            <Button variant="ghost" size="sm" className="text-danger" type="submit">
              <Trash2 aria-hidden /> Borrar lista
            </Button>
          </form>
        }
      />
      {total && <BudgetBar total={total.total} budget={list.budget} />}

      <Card>
        <CardContent>
          <EditListForm listId={list.id} name={list.name} budget={list.budget} />
        </CardContent>
      </Card>

      {!cards.length ? (
        <EmptyState
          icon={PackageOpen}
          title="Lista vacía"
          description="Abre un producto que sigues y usa “Agregar a una lista”."
        >
          <Button asChild variant="outline">
            <Link href="/seguimientos">Ir a mis seguimientos</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <div key={c.watchId} className="relative">
              <WatchCard card={c} />
              <form action={removeFromList.bind(null, list.id, c.watchId)} className="absolute top-2 right-2">
                <Button size="icon-sm" variant="secondary" type="submit" aria-label={`Quitar ${c.name} de la lista`}>
                  <X aria-hidden className="size-4" />
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
