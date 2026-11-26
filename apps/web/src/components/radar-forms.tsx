"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useActionState, useTransition, useState } from "react";
import { DEAL_CATEGORIES, DEAL_CATEGORY_IDS } from "@rastreador/core";
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
  catsInclude,
  catsExclude,
  blockWords,
}: {
  keywords: string[];
  priceErrors: boolean;
  hotLevel: number;
  hotWords: string[];
  catsInclude: string[];
  catsExclude: string[];
  blockWords: string[];
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
      <fieldset className="flex flex-col gap-3 border-t">
        <legend className="sr-only">Filtros por categoría</legend>
        <p className="pt-3 text-sm font-medium">Filtros por categoría</p>
        <p className="-mt-2 text-xs text-muted-foreground">
          Se aplican a las ofertas destacadas y a los errores de precio. Lo que sigues y tus palabras a vigilar te llegan igual.
        </p>
        <CategoryChips name="catExclude" title="Nunca avisarme de" checked={catsExclude} tone="danger" />
        <CategoryChips name="catInclude" title="Avisarme solo de (vacío = todas)" checked={catsInclude} tone="brand" />
        <div className="flex flex-col gap-2">
          <Label htmlFor="blockWords">Palabras que nunca quiero ver</Label>
          <textarea
            id="blockWords"
            name="blockWords"
            rows={2}
            defaultValue={blockWords.join(", ")}
            placeholder="Ej: crocs, pañal, vino"
            aria-describedby="blockWords-hint"
            className="rounded-xl border border-input bg-card px-4 py-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
          />
          <p id="blockWords-hint" className="text-xs text-muted-foreground">
            Separadas por coma, sin importar tildes. Para lo que las categorías no alcanzan a cubrir.
          </p>
        </div>
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

function CategoryChips({ name, title, checked, tone }: { name: string; title: string; checked: string[]; tone: "brand" | "danger" }) {
  const on = tone === "danger" ? "has-[:checked]:border-danger has-[:checked]:bg-danger/10 has-[:checked]:text-danger" : "has-[:checked]:border-brand has-[:checked]:bg-brand/10 has-[:checked]:text-brand";
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {DEAL_CATEGORY_IDS.map((c) => (
          <label
            key={c}
            className={`group cursor-pointer rounded-full border px-3 py-1 text-xs font-medium select-none has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ring/15 ${on}`}
          >
            <input type="checkbox" name={name} value={c} defaultChecked={checked.includes(c)} className="sr-only" />
            <span aria-hidden className="mr-1 hidden group-has-[:checked]:inline">
              {tone === "danger" ? "✕" : "✓"}
            </span>
            {DEAL_CATEGORIES[c].label}
          </label>
        ))}
      </div>
    </div>
  );
}
