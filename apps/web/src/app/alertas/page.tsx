import { BellOff } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Alertas" };

export default async function AlertasPage() {
  await requireUser("/alertas");
  return (
    <>
      <PageHeader title="Alertas" description="Avisos enviados por Telegram y correo." />
      <EmptyState
        icon={BellOff}
        title="Sin alertas por ahora"
        description="Cuando un producto que sigues baje de tu precio objetivo, llegue a su mínimo o vuelva a tener stock, lo verás aquí."
      />
    </>
  );
}
