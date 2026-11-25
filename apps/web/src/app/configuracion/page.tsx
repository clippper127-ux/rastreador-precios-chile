import { schema } from "@rastreador/db";
import { eq } from "drizzle-orm";
import { Activity, ChevronRight, LogOut, Mail, MapPin } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { ExtensionTokenCard } from "@/components/extension-token-card";
import { NotificationSettings } from "@/components/notification-settings";
import { PageHeader } from "@/components/page-header";
import { PasswordForm } from "@/components/password-form";
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
            <CardTitle>Contraseña</CardTitle>
            <CardDescription>
              Cada navegador (Chrome, el celular, otro PC) guarda su propia sesión. Con una contraseña entras al tiro en
              cualquiera, sin esperar un correo. Tu navegador puede recordarla.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>
        <Link
          href="/estado"
          className="flex items-center gap-4 rounded-xl border bg-card p-5 shadow-soft transition-shadow hover:shadow-lift sm:p-6"
        >
          <div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Activity aria-hidden className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold tracking-tight">Estado del sistema</p>
            <p className="text-sm text-muted-foreground">Tiendas, worker, avisos y uso de los planes gratis.</p>
          </div>
          <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
        </Link>
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
