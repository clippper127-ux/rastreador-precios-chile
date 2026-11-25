"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useActionState, useTransition, useState } from "react";
import { addChannel, checkRadarNow, saveRadarPrefs, type RadarMsg } from "@/app/radar-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Msg({ m }: { m: RadarMsg }) {
  if (!m) return null;
  return "ok" in m ? (
    <p role="status" className="text-sm text-deal">{m.ok}</p>
  ) : (
    <p role="alert" className="text-sm text-danger">{m.error}</p>
  );
}

export function AddChannelForm() {
  const [state, action, pending] = useActionState<RadarMsg, FormData>(addChannel, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <Label htmlFor="channel">Canal público de Telegram</Label>
      <div className="flex gap-2">
        <Input id="channel" name="channel" placeholder="@canal o t.me/canal" required autoComplete="off" />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
          Agregar
        </Button>
      </div>
      <Msg m={state} />
    </form>
  );
}

export function RadarPrefsForm({ keywords, priceErrors }: { keywords: string[]; priceErrors: boolean }) {
  const [state, action, pending] = useActionState<RadarMsg, FormData>(saveRadarPrefs, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="keywords">Palabras a vigilar</Label>
        <textarea
          id="keywords"
          name="keywords"
          rows={3}
          defaultValue={keywords.join(", ")}
          placeholder="Ej: airfryer philips, ps5, iphone 15"
          className="rounded-xl border border-input bg-card px-4 py-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
        />
        <p className="text-xs text-muted-foreground">
          Separadas por coma. Además te avisamos de los productos que ya sigues, sin escribirlos aquí.
        </p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="priceErrors" defaultChecked={priceErrors} className="mt-0.5 size-4 accent-[var(--brand)]" />
        <span>
          <span className="font-medium">Avisarme de “errores de precio”</span>
          <span className="block text-xs text-muted-foreground">Mensajes que digan error de precio, preciazo, bug…</span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Guardar
        </Button>
        <Msg m={state} />
      </div>
    </form>
  );
}

export function CheckNowButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<RadarMsg>();
  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => setMsg(await checkRadarNow()))}>
        <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} />
        Revisar ahora
      </Button>
      <Msg m={msg} />
    </div>
  );
}
