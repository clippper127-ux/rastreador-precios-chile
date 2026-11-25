import { LogOut, Mail, MapPin, Send } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { headers } from "next/headers";
import { ExtensionTokenCard } from "@/components/extension-token-card";
import { db } from "@/lib/db";
import { hasExtensionToken } from "@/lib/extension-token";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ajustes" };

export default async function ConfiguracionPage() {
  const user = await requireUser("/configuracion");
  const hasToken = await hasExtensionToken(db(), user.id);
  const h = await headers();
  const apiUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  return (
    <>
      <PageHeader title="Ajustes" description="Canales de aviso, comuna y tiendas activas." />
      <div className="grid gap-4 lg:grid-cols-2">
        <ExtensionTokenCard hasToken={hasToken} apiUrl={apiUrl} />
        <Card>
          <CardHeader>
            <CardTitle>Cuenta</CardTitle>
            <CardDescription>Sesión iniciada como</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-medium break-all">{user.email}</span>
            <form action="/auth/signout" method="post">
              <Button variant="outline" size="sm" type="submit">
                <LogOut aria-hidden />
                Cerrar sesión
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Canales de aviso</CardTitle>
            <CardDescription>Se configuran en la Fase 4.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Row icon={Send} label="Telegram" status="Sin vincular" />
            <Row icon={Mail} label="Correo" status="Sin activar" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Comuna</CardTitle>
            <CardDescription>Para estimar el despacho cuando la tienda lo muestre (Fase 7).</CardDescription>
          </CardHeader>
          <CardContent>
            <Row icon={MapPin} label="Comuna" status="Sin definir" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ icon: Icon, label, status }: { icon: typeof Mail; label: string; status: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3">
      <span className="flex items-center gap-2.5 text-sm font-medium">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
        {label}
      </span>
      <Badge variant="outline">{status}</Badge>
    </div>
  );
}
