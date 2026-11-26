"use server";

import { schema } from "@rastreador/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { userCanSeeCoupon } from "@/lib/coupons";
import { db } from "@/lib/db";
import { getUser } from "@/lib/supabase/server";

/** Marca un cupón como "ya no funciona" (o lo vuelve a dejar disponible). Lo ven todos los que siguen ese grupo. */
export async function setCouponAvailable(couponId: number, available: boolean): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login?next=/cupones");
  if (!Number.isSafeInteger(couponId) || !(await userCanSeeCoupon(user.id, couponId))) return;
  await db()
    .update(schema.dealCoupons)
    .set(available ? { expiredAt: null, expiredReason: null } : { expiredAt: new Date(), expiredReason: "usuario" })
    .where(eq(schema.dealCoupons.id, couponId));
  revalidatePath("/cupones");
}
