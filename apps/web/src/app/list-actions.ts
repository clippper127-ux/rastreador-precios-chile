"use server";

import { schema } from "@rastreador/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getUser } from "@/lib/supabase/server";

export type ListMsg = { ok: string } | { error: string } | undefined;

async function uid(next = "/listas") {
  const u = await getUser();
  if (!u) redirect(`/login?next=${next}`);
  return u.id;
}

function clp(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? "").replace(/[^\d]/g, "");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function ownList(userId: string, listId: string) {
  return db().query.collections.findFirst({
    where: and(eq(schema.collections.id, listId), eq(schema.collections.userId, userId)),
  });
}

export async function createList(_prev: ListMsg, form: FormData): Promise<ListMsg> {
  const userId = await uid();
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  if (name.length < 2) return { error: "Ponle un nombre a la lista." };
  const [c] = await db()
    .insert(schema.collections)
    .values({ userId, name, budget: clp(form.get("budget")) })
    .returning({ id: schema.collections.id });
  revalidatePath("/listas");
  redirect(`/listas/${c!.id}`);
}

export async function updateList(listId: string, _prev: ListMsg, form: FormData): Promise<ListMsg> {
  const userId = await uid(`/listas/${listId}`);
  if (!(await ownList(userId, listId))) return { error: "No encontramos la lista." };
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  await db()
    .update(schema.collections)
    // Un presupuesto nuevo rearma el aviso.
    .set({ ...(name.length >= 2 && { name }), budget: clp(form.get("budget")), notifiedTotal: null })
    .where(eq(schema.collections.id, listId));
  revalidatePath(`/listas/${listId}`);
  revalidatePath("/listas");
  return { ok: "Guardado" };
}

export async function deleteList(listId: string): Promise<void> {
  const userId = await uid();
  await db().delete(schema.collections).where(and(eq(schema.collections.id, listId), eq(schema.collections.userId, userId)));
  revalidatePath("/listas");
  redirect("/listas");
}

/** Agrega un producto que sigo a una de mis listas. */
export async function addToList(productId: string, _prev: ListMsg, form: FormData): Promise<ListMsg> {
  const userId = await uid(`/producto/${productId}`);
  const listId = String(form.get("listId") ?? "");
  if (!(await ownList(userId, listId))) return { error: "Elige una lista." };
  const watch = await db().query.watches.findFirst({
    where: and(eq(schema.watches.userId, userId), eq(schema.watches.productId, productId)),
  });
  if (!watch) return { error: "No sigues este producto." };
  await db().insert(schema.collectionItems).values({ collectionId: listId, watchId: watch.id }).onConflictDoNothing();
  revalidatePath(`/listas/${listId}`);
  revalidatePath("/listas");
  return { ok: "Agregado a la lista" };
}

export async function removeFromList(listId: string, watchId: string): Promise<void> {
  const userId = await uid(`/listas/${listId}`);
  if (!(await ownList(userId, listId))) return;
  await db()
    .delete(schema.collectionItems)
    .where(and(eq(schema.collectionItems.collectionId, listId), eq(schema.collectionItems.watchId, watchId)));
  revalidatePath(`/listas/${listId}`);
}
