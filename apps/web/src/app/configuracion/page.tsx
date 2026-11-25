import { schema } from "@rastreador/db";
import { eq } from "drizzle-orm";
import { LogOut, Mail, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { ExtensionTokenCard } from "@/components/extension-token-card";
import { NotificationSettings } from "@/components/notification-settings";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ajustes" };

export default async function ConfiguracionPage() {
  const user = await requireUser("/configuracion");
  const profile = await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) });
  const h = await headers();
  const apiUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <>
      <PageHeader title="Ajustes" description="Canales de aviso, extensión y cuenta." />
      <div className="grid gap-4 lg:grid-cols-2">
        <NotificationSettings
          telegramLinked={!!profile?.telegramChatId}
          botConfigured={!!process.env.TELEGRAM_BOT_TOKEN}
          emailEnabled={profile?.emailAlerts ?? true}
          emailConfigured={!!process.env.RESEND_API_KEY}
          email={user.email}
        />
        <ExtensionTokenCard hasToken={!!profile?.extensionTokenHash} apiUrl={apiUrl} />
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
