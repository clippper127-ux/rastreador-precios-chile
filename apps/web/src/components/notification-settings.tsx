"use client";

import { ExternalLink, Loader2, Mail, Send } from "lucide-react";
import { useState, useTransition } from "react";
import {
  checkTelegram,
  disconnectTelegram,
  linkTelegram,
  setEmailAlerts,
  testEmail,
  testTelegram,
  type ActionMsg,
} from "@/app/alert-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function Feedback({ msg }: { msg: ActionMsg }) {
  if (!msg || "link" in msg) return null;
  return "ok" in msg ? (
    <p role="status" className="text-sm text-deal">{msg.ok}</p>
  ) : (
    <p role="alert" className="text-sm text-danger">{msg.error}</p>
  );
}

export function NotificationSettings({
  telegramLinked,
  botConfigured,
  emailEnabled,
  emailConfigured,
  email,
}: {
  telegramLinked: boolean;
  botConfigured: boolean;
  emailEnabled: boolean;
  emailConfigured: boolean;
  email?: string;
}) {
  const [pending, start] = useTransition();
  const [tgMsg, setTgMsg] = useState<ActionMsg>();
  const [mailMsg, setMailMsg] = useState<ActionMsg>();
  const [link, setLink] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionMsg | void>, set: (m: ActionMsg) => void) =>
    start(async () => {
      const r = await fn();
      if (r && "link" in r) setLink(r.link);
      set(r ?? undefined);
    });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Canales de aviso</CardTitle>
        <CardDescription>
          Dónde te llegan las alertas. Si no activas ninguno, igual quedan en la página Alertas.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {/* Telegram */}
        <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <Send aria-hidden className="size-4 text-brand" />
              Telegram
            </span>
            {telegramLinked ? <Badge variant="deal">Vinculado</Badge> : <Badge variant="outline">Sin vincular</Badge>}
          </div>
          {!botConfigured ? (
            <p className="text-sm text-muted-foreground">
              Falta crear el bot (gratis, 2 minutos). Sigue los pasos del README → <strong>Alertas</strong> y reinicia la app.
            </p>
          ) : telegramLinked ? (
            <>
              <p className="text-sm text-muted-foreground">
                También puedes reenviarle ofertas de tus grupos: si traen links de tiendas soportadas, las sigue por ti.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(testTelegram, setTgMsg)}>
                  Enviar prueba
                </Button>
                <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => run(disconnectTelegram, setTgMsg)}>
                  Desvincular
                </Button>
              </div>
            </>
          ) : link ? (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Abre el bot y toca <strong>Iniciar</strong>.</li>
                <li>Vuelve aquí y confirma.</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    Abrir Telegram <ExternalLink aria-hidden />
                  </a>
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(checkTelegram, setTgMsg)}>
                  {pending && <Loader2 aria-hidden className="animate-spin" />}
                  Ya toqué Iniciar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">El link vence en 15 minutos.</p>
            </>
          ) : (
            <Button size="sm" className="self-start" disabled={pending} onClick={() => run(linkTelegram, setTgMsg)}>
              Vincular Telegram
            </Button>
          )}
          <Feedback msg={tgMsg} />
        </div>

        {/* Correo */}
        <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <Mail aria-hidden className="size-4 text-brand" />
              Correo
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                defaultChecked={emailEnabled}
                disabled={pending}
                onChange={(e) => {
                  const v = e.currentTarget.checked;
                  start(async () => setEmailAlerts(v));
                }}
              />
              Activado
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            {emailConfigured
              ? `A ${email ?? "tu correo"}. Sin dominio propio, Resend solo envía al correo de tu cuenta de Resend.`
              : "Falta RESEND_API_KEY (ver README → Alertas)."}
          </p>
          {emailConfigured && (
            <Button size="sm" variant="outline" className="self-start" disabled={pending} onClick={() => run(testEmail, setMailMsg)}>
              Enviar prueba
            </Button>
          )}
          <Feedback msg={mailMsg} />
        </div>
      </CardContent>
    </Card>
  );
}
