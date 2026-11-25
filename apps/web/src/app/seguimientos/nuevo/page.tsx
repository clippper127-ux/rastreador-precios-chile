import { EXTENSION_STORES, adapters } from "@rastreador/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ManualProductForm } from "@/components/manual-product-forms";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Crear producto" };

export default async function NuevoProductoPage() {
  await requireUser("/seguimientos/nuevo");
  const stores = [...adapters.map((a) => a.name), ...EXTENSION_STORES.map((s) => s.name)].join(", ");
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link
        href="/seguimientos"
        className="inline-flex w-fit items-center gap-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Mis seguimientos
      </Link>
      <PageHeader
        title="Crear producto a mano"
        description="Ponle un nombre y pega los links de las tiendas donde lo venden. Lo seguimos como un solo producto y comparamos sus precios."
      />
      <Card>
        <CardContent>
          <ManualProductForm stores={stores} />
        </CardContent>
      </Card>
    </div>
  );
}
