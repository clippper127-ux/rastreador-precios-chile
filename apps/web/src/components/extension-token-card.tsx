"use client";

import { Check, Copy, KeyRound, Loader2, Puzzle, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { createExtensionToken, deleteExtensionToken } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ExtensionTokenCard({ hasToken, apiUrl }: { hasToken: boolean; apiUrl: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const active = hasToken || !!token;

  function generate() {
    start(async () => {
      const r = await createExtensionToken();
      if (r && "token" in r) setToken(r.token);
    });
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* el input queda seleccionable para copiar a mano */
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Puzzle aria-hidden className="size-5 text-brand" />
          Extensión de navegador
          {active && <Badge variant="deal">Conectada</Badge>}
        </CardTitle>
        <CardDescription>
          Actualiza los precios de Falabella, Paris, Ripley y Lider cuando abres sus fichas. Solo envía datos de fichas de
          producto de esas tiendas.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {token ? (
          <div className="flex flex-col gap-2 rounded-xl bg-accent p-4">
            <p className="text-sm font-medium text-accent-foreground">
              Copia este token y pégalo en la extensión. No lo volveremos a mostrar.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={token}
                aria-label="Token de la extensión"
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 min-w-0 flex-1 rounded-lg border bg-card px-3 font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={copy}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Dirección de la app para la extensión: <code className="font-mono">{apiUrl}</code>
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={generate} disabled={pending} variant={active ? "outline" : "default"}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : active ? <RefreshCw aria-hidden /> : <KeyRound aria-hidden />}
            {active ? "Generar token nuevo" : "Conectar extensión"}
          </Button>
          {active && (
            <Button
              type="button"
              variant="ghost"
              className="text-danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await deleteExtensionToken();
                  setToken(null);
                })
              }
            >
              Desconectar
            </Button>
          )}
        </div>
        {active && !token && (
          <p className="text-xs text-muted-foreground">Generar un token nuevo desconecta el anterior.</p>
        )}
      </CardContent>
    </Card>
  );
}
