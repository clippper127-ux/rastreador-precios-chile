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
