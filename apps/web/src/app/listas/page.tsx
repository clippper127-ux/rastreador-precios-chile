import { formatCLP } from "@rastreador/core";
import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BudgetBar } from "@/components/budget-bar";
import { EmptyState } from "@/components/empty-state";
import { CreateListForm } from "@/components/list-forms";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLists } from "@/lib/lists";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Listas" };

export default async function ListasPage() {
  const user = await requireUser("/listas");
  const lists = await getLists(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Listas" description="Agrupa productos (Navidad, setup...) con un presupuesto. Te avisamos cuando la lista completa quede bajo él." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nueva lista</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateListForm />
        </CardContent>
      </Card>

      {!lists.length ? (
        <EmptyState icon={ListChecks} title="Todavía no tienes listas" description="Crea una y agrega productos desde su página de detalle." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {lists.map((l) => {
            const complete = l.items > 0 && l.priced === l.items;
            return (
              <Link key={l.id} href={`/listas/${l.id}`} className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-soft transition-shadow hover:shadow-lift">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold tracking-tight">{l.name}</h2>
                  <Badge variant="outline">{l.items} {l.items === 1 ? "producto" : "productos"}</Badge>
                </div>
                <p className="tabular text-2xl font-semibold tracking-tight">
                  {formatCLP(l.total)}
                  {l.budget != null && <span className="text-sm font-normal text-muted-foreground"> / {formatCLP(l.budget)}</span>}
                </p>
                <BudgetBar total={l.total} budget={l.budget} />
                {l.budget != null && complete && (
                  <Badge variant={l.total <= l.budget ? "deal" : "caution"}>
                    {l.total <= l.budget ? "Bajo el presupuesto" : `Faltan ${formatCLP(l.total - l.budget)} para el presupuesto`}
                  </Badge>
                )}
                {!complete && l.items > 0 && <p className="text-xs text-muted-foreground">Algunos productos aún no tienen precio.</p>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
