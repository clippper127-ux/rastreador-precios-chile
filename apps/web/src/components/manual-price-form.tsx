"use client";

import { Check, PencilLine } from "lucide-react";
import { useActionState, useState } from "react";
import { manualPrice, type ManualResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "Actualizar precio a mano": plegado por defecto, para cuando ni el servidor ni la extensión llegan. */
export function ManualPriceForm({ listingId, storeName }: { listingId: string; storeName: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ManualResult, FormData>(manualPrice.bind(null, listingId), undefined);

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PencilLine aria-hidden />
        Ingresar precio a mano
      </Button>
    );
  }

  const ids = (k: string) => `${listingId}-${k}`;
  return (
    <form action={action} className="mt-2 grid w-full gap-3 rounded-xl bg-muted/60 p-4 sm:grid-cols-4">
      <p className="text-sm font-medium sm:col-span-4">Precio que ves ahora en {storeName}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids("normal")}>Normal</Label>
        <Input id={ids("normal")} name="normal" inputMode="numeric" placeholder="$0" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids("offer")}>Oferta</Label>
        <Input id={ids("offer")} name="offer" inputMode="numeric" placeholder="Opcional" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids("card")}>Con tarjeta</Label>
        <Input id={ids("card")} name="card" inputMode="numeric" placeholder="Opcional" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids("stock")}>Stock</Label>
        <select
          id={ids("stock")}
          name="stock"
          defaultValue="in_stock"
          className="h-11 rounded-xl border border-input bg-card px-3 text-sm md:h-11"
        >
          <option value="in_stock">En stock</option>
          <option value="out_of_stock">Sin stock</option>
          <option value="preorder">Preventa</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          Guardar precio
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        {state && "error" in state && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {state && "ok" in state && (
          <p role="status" className="flex items-center gap-1 text-sm text-deal">
            <Check aria-hidden className="size-4" /> Guardado
          </p>
        )}
      </div>
    </form>
  );
}
