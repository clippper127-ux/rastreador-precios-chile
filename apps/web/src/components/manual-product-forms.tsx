"use client";

import { Loader2, PackagePlus, PencilLine, Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { addLinkToProduct, createManualProduct, renameProduct, type ManualProductResult } from "@/app/manual-product-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const textarea =
  "min-h-32 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Msg({ m }: { m: ManualProductResult }) {
  if (!m) return null;
  if ("ok" in m) return <p role="status" className="text-sm text-deal">{m.ok}</p>;
  return (
    <div role="alert" className="text-sm text-danger">
      <p>{m.error}</p>
      {m.bad && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 break-all">
          {m.bad.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Crear un producto con nombre propio y los links de las tiendas donde lo venden. */
export function ManualProductForm({ stores }: { stores: string }) {
  const [state, action, pending] = useActionState<ManualProductResult, FormData>(createManualProduct, undefined);
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre del producto</Label>
        <Input id="name" name="name" placeholder="Ej: Consola PS5 Slim Digital" maxLength={120} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="links">Links de las tiendas</Label>
        <textarea
          id="links"
          name="links"
          required
          className={textarea}
          placeholder={"https://www.falabella.com/falabella-cl/product/...\nhttps://simple.ripley.cl/...\nhttps://www.hites.com/..."}
          aria-describedby="links-help"
        />
        <p id="links-help" className="text-xs text-muted-foreground">
          Uno por línea, hasta 10. Abre la ficha del producto en cada tienda y copia su link. Tiendas: {stores}.
        </p>
      </div>
      <Msg m={state} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <PackagePlus aria-hidden />}
        Crear y seguir
      </Button>
    </form>
  );
}

/** En el detalle: pegar el link de otra tienda para sumarla al mismo producto. */
export function AddLinkForm({ productId }: { productId: string }) {
  const [state, action, pending] = useActionState<ManualProductResult, FormData>(addLinkToProduct.bind(null, productId), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Label htmlFor="add-link" className="sr-only">
          Link de otra tienda
        </Label>
        <Input id="add-link" name="links" type="url" placeholder="https://… (ficha del producto en otra tienda)" required className="flex-1" />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
          Agregar tienda
        </Button>
      </div>
      <Msg m={state} />
    </form>
  );
}

/** Renombrar (plegado). */
export function RenameProductForm({ productId, name }: { productId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ManualProductResult, FormData>(renameProduct.bind(null, productId), undefined);
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PencilLine aria-hidden />
        Cambiar nombre
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Label htmlFor="rename" className="sr-only">
          Nombre
        </Label>
        <Input id="rename" name="name" defaultValue={name} maxLength={120} required className="flex-1" />
        <Button type="submit" size="sm" disabled={pending}>
          Guardar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
      <Msg m={state} />
    </form>
  );
}

