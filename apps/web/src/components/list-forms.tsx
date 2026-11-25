"use client";

import { ListPlus, Plus } from "lucide-react";
import { useActionState } from "react";
import { addToList, createList, updateList, type ListMsg } from "@/app/list-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Msg({ m }: { m: ListMsg }) {
  if (!m) return null;
  return "ok" in m ? <p role="status" className="text-sm text-deal">{m.ok}</p> : <p role="alert" className="text-sm text-danger">{m.error}</p>;
}

const clp = (n: number | null | undefined) => (n ? `$${n.toLocaleString("es-CL")}` : "");

export function CreateListForm() {
  const [state, action, pending] = useActionState<ListMsg, FormData>(createList, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre</Label>
        <Input id="name" name="name" placeholder="Ej: Navidad, Setup escritorio" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="budget">Presupuesto (opcional)</Label>
        <Input id="budget" name="budget" inputMode="numeric" placeholder="$0" />
      </div>
      <Button type="submit" disabled={pending}>
        <Plus aria-hidden /> Crear lista
      </Button>
      <div className="sm:col-span-3">
        <Msg m={state} />
      </div>
    </form>
  );
}

export function EditListForm({ listId, name, budget }: { listId: string; name: string; budget: number | null }) {
  const [state, action, pending] = useActionState<ListMsg, FormData>(updateList.bind(null, listId), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="budget">Presupuesto</Label>
        <Input id="budget" name="budget" inputMode="numeric" defaultValue={clp(budget)} placeholder="$0" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Guardar
      </Button>
      <div className="sm:col-span-3">
        <Msg m={state} />
      </div>
    </form>
  );
}

export function AddToListForm({ productId, lists }: { productId: string; lists: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ListMsg, FormData>(addToList.bind(null, productId), undefined);
  if (!lists.length) return null;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-[180px] flex-1 flex-col gap-2">
        <Label htmlFor="listId">Agregar a una lista</Label>
        <select id="listId" name="listId" className="h-11 rounded-xl border border-input bg-card px-3 text-sm">
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        <ListPlus aria-hidden /> Agregar
      </Button>
      <div className="w-full">
        <Msg m={state} />
      </div>
    </form>
  );
}
