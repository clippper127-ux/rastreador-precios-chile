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

const HOT_OPTIONS = [
  { value: 0, label: "Apagado", hint: "Solo lo que sigues y tus palabras" },
  { value: 1, label: "Pocas", hint: "Solo las muy buenas · máx. 5 al día" },
  { value: 2, label: "Normal", hint: "Máx. 10 al día" },
  { value: 3, label: "Muchas", hint: "Más avisos · máx. 20 al día" },
];

export function RadarPrefsForm({
  keywords,
  priceErrors,
  hotLevel,
  hotWords,
}: {
  keywords: string[];
  priceErrors: boolean;
  hotLevel: number;
  hotWords: string[];
}) {
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
      <fieldset className="flex flex-col gap-2 border-t">
        <legend className="sr-only">Ofertas destacadas</legend>
        <p className="pt-3 text-sm font-medium">🔥 Ofertas destacadas</p>
        <p className="text-xs text-muted-foreground">
          Te avisamos de ofertas muy buenas aunque no sean algo que sigues: gran descuento, palabras como “regalado” o
          “corran”, muchas reacciones y respuestas en el grupo, o precio bajo su mínimo histórico. La misma oferta en
          varios grupos llega una sola vez.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {HOT_OPTIONS.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand/5 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ring/15"
            >
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="hotLevel" value={o.value} defaultChecked={hotLevel === o.value} className="accent-[var(--brand)]" />
                {o.label}
              </span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </label>
          ))}
        </div>
        <Label htmlFor="hotWords" className="mt-1">
          Palabras que delatan una buena oferta
        </Label>
        <textarea
          id="hotWords"
          name="hotWords"
          rows={2}
          defaultValue={hotWords.join(", ")}
          placeholder="Ej: tiradísimo, a mitad de precio, botado"
          aria-describedby="hotWords-hint"
          className="rounded-xl border border-input bg-card px-4 py-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
        />
        <p id="hotWords-hint" className="text-xs text-muted-foreground">
          Separadas por coma, sin importar tildes. Se suman a las que ya reconocemos: regalado, corran, ganga, ofertón,
          preciazo, precio histórico, quedan pocos, a luca, 🔥🔥…
        </p>
      </fieldset>
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
