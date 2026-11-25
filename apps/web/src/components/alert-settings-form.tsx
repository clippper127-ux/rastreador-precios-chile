"use client";

import { Bell } from "lucide-react";
import { useActionState } from "react";
import { saveAlertSettings, type ActionMsg } from "@/app/alert-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AlertSettingsValues {
  targetPrice: number | null;
  dropPct: string | null;
  notifyAllTimeLow: boolean;
  notifyRestock: boolean;
  excludeThirdParty: boolean;
  priceBasis: "no_card" | "with_card";
  channels: string[];
}

const clp = (n: number) => `$${n.toLocaleString("es-CL")}`;

function Check({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-1.5">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--brand)]" />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function AlertSettingsForm({
  productId,
  values,
  suggestedTarget,
  hasThirdParty,
}: {
  productId: string;
  values: AlertSettingsValues;
  suggestedTarget?: number;
  hasThirdParty: boolean;
}) {
  const [state, action, pending] = useActionState<ActionMsg, FormData>(saveAlertSettings.bind(null, productId), undefined);
  const ch = new Set(values.channels);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell aria-hidden className="size-5 text-brand" />
          Alertas
        </CardTitle>
        <CardDescription>Te avisamos una vez por evento; no se repite mientras el precio siga igual.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="target">Avisarme si baja de</Label>
              <Input
                id="target"
                name="target"
                inputMode="numeric"
                placeholder={suggestedTarget ? clp(suggestedTarget) : "$0"}
                defaultValue={values.targetPrice ? clp(values.targetPrice) : ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="dropPct">o si baja más de (%)</Label>
              <Input id="dropPct" name="dropPct" inputMode="decimal" placeholder="Ej: 10" defaultValue={values.dropPct ?? ""} />
            </div>
          </div>

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Comparar con</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="priceBasis" value="no_card" defaultChecked={values.priceBasis === "no_card"} className="accent-[var(--brand)]" />
                Precio sin tarjeta
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="priceBasis" value="with_card" defaultChecked={values.priceBasis === "with_card"} className="accent-[var(--brand)]" />
                Precio con tarjeta de la tienda
              </label>
            </div>
          </fieldset>

          <div className="grid gap-1 sm:grid-cols-2">
            <Check name="notifyAllTimeLow" label="Mínimo histórico" hint="Cuando llega al precio más bajo registrado" defaultChecked={values.notifyAllTimeLow} />
            <Check name="notifyRestock" label="Vuelve el stock" defaultChecked={values.notifyRestock} />
            {hasThirdParty && (
              <Check name="excludeThirdParty" label="Ignorar vendedores terceros" hint="Solo avisos de la tienda o tiendas oficiales" defaultChecked={values.excludeThirdParty} />
            )}
          </div>

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Avisarme por</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="ch_telegram" defaultChecked={ch.has("telegram")} className="size-4 accent-[var(--brand)]" />
                Telegram
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="ch_email" defaultChecked={ch.has("email")} className="size-4 accent-[var(--brand)]" />
                Correo
              </label>
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              Guardar alertas
            </Button>
            {state && "ok" in state && <p role="status" className="text-sm text-deal">{state.ok}</p>}
            {state && "error" in state && <p role="alert" className="text-sm text-danger">{state.error}</p>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
