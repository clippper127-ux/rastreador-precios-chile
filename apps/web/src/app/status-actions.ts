"use server";

import { schema } from "@rastreador/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getUser } from "@/lib/supabase/server";

/** Solo administradores (profiles.is_admin; se asigna con `pnpm db:admin <correo>`). */
async function requireAdmin() {
  const user = await getUser();
  if (!user) redirect("/login?next=/estado");
  const p = await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id), columns: { isAdmin: true } });
  if (!p?.isAdmin) throw new Error("Solo administradores");
}

export async function setStorePaused(storeId: string, paused: boolean): Promise<void> {
  await requireAdmin();
  await db().update(schema.stores).set({ paused }).where(eq(schema.stores.id, storeId));
  revalidatePath("/estado");
}

/** Quita el bloqueo/backoff de una tienda para que el worker vuelva a intentar en la próxima pasada. */
export async function resetStoreBackoff(storeId: string): Promise<void> {
  await requireAdmin();
  await db()
    .update(schema.stores)
    .set({ status: "ok", backoffLevel: 0, blockedUntil: null })
    .where(eq(schema.stores.id, storeId));
  revalidatePath("/estado");
}

export type EventMsg = { ok: string } | { error: string } | undefined;

/** Calendario de eventos de descuento: durante un evento el worker revisa más seguido. */
export async function addSaleEvent(_prev: EventMsg, form: FormData): Promise<EventMsg> {
  await requireAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  const starts = new Date(String(form.get("startsOn") ?? ""));
  const ends = new Date(String(form.get("endsOn") ?? ""));
  const interval = Number.parseInt(String(form.get("interval") ?? "120"), 10);
  if (name.length < 2 || Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return { error: "Completa nombre y fechas." };
  if (ends < starts) return { error: "La fecha de término es anterior al inicio." };
  await db()
    .insert(schema.saleEvents)
    .values({
      name,
      startsOn: starts,
      endsOn: ends,
      checkIntervalMin: Number.isFinite(interval) ? Math.min(Math.max(interval, 60), 720) : 120,
      tentative: form.get("tentative") === "on",
    });
  revalidatePath("/estado");
  return { ok: "Evento agregado" };
}

export async function deleteSaleEvent(id: string): Promise<void> {
  await requireAdmin();
  await db().delete(schema.saleEvents).where(eq(schema.saleEvents.id, id));
  revalidatePath("/estado");
}

export async function confirmSaleEvent(id: string): Promise<void> {
  await requireAdmin();
  await db().update(schema.saleEvents).set({ tentative: false }).where(eq(schema.saleEvents.id, id));
  revalidatePath("/estado");
}
