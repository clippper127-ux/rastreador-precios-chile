"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";
import { addSaleEvent, type EventMsg } from "@/app/status-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddEventForm() {
  const [state, action, pending] = useActionState<EventMsg, FormData>(addSaleEvent, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_150px_150px_120px_auto] sm:items-end">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ev-name">Evento</Label>
        <Input id="ev-name" name="name" placeholder="Ej: CyberDay" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ev-start">Inicio</Label>
        <Input id="ev-start" name="startsOn" type="date" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ev-end">Término</Label>
        <Input id="ev-end" name="endsOn" type="date" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ev-int">Revisar cada (min)</Label>
        <Input id="ev-int" name="interval" type="number" min={60} max={720} step={30} defaultValue={120} />
      </div>
      <Button type="submit" disabled={pending}>
        <Plus aria-hidden /> Agregar
      </Button>
      <label className="flex items-center gap-2 text-sm sm:col-span-5">
        <input type="checkbox" name="tentative" className="size-4 accent-[var(--brand)]" /> Fechas aún no confirmadas
      </label>
      {state && (
        <p role={"error" in state ? "alert" : "status"} className={"error" in state ? "text-sm text-danger sm:col-span-5" : "text-sm text-deal sm:col-span-5"}>
          {"error" in state ? state.error : state.ok}
        </p>
      )}
    </form>
  );
}
