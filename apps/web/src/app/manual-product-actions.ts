"use server";

import { parseListingUrl, type ParsedListingUrl } from "@rastreador/core";
import { schema } from "@rastreador/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getUser } from "@/lib/supabase/server";
import { ensureTracked } from "@/lib/track";

export type ManualProductResult = { error: string; bad?: string[] } | { ok: string } | undefined;

const MAX_LINKS = 10;

const WHY: Record<string, string> = {
  invalid: "no es un link válido",
  unsupported: "tienda no soportada todavía",
  not_product: "no es la ficha de un producto",
};

/** Saca los links de un texto pegado (uno por línea, o mezclados con texto). */
function extractLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[),.;]+$/, "")))];
}

type Ok = Extract<ParsedListingUrl, { ok: true }>;

async function validate(links: string[]): Promise<{ ok: Ok[]; bad: string[] }> {
  const ok: Ok[] = [];
  const bad: string[] = [];
  const enabled = new Set(
    (await db().select({ id: schema.stores.id, enabled: schema.stores.enabled }).from(schema.stores)).filter((s) => s.enabled).map((s) => s.id),
  );
  for (const link of links) {
    const p = parseListingUrl(link);
    if (!p.ok) bad.push(`${link} → ${WHY[p.reason] ?? "no se pudo usar"}`);
    else if (!enabled.has(p.storeId)) bad.push(`${link} → ${p.storeName} está pausada`);
    else if (!ok.some((o) => o.url === p.url)) ok.push(p);
  }
  return { ok, bad };
}

/**
 * Crear un producto a mano: le pones el nombre y pegas los links de las tiendas donde lo venden.
 * Queda UN producto con todas esas tiendas. Si algún link no sirve, no se crea nada y se dice cuál.
 */
export async function createManualProduct(_prev: ManualProductResult, formData: FormData): Promise<ManualProductResult> {
  const user = await getUser();
  if (!user) redirect("/login?next=/seguimientos/nuevo");

  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (name.length < 2) return { error: "Escribe un nombre para el producto." };
  const links = extractLinks(String(formData.get("links") ?? ""));
  if (!links.length) return { error: "Pega al menos un link de una tienda (empieza con https://)." };
  if (links.length > MAX_LINKS) return { error: `Máximo ${MAX_LINKS} links por producto.` };

  const { ok, bad } = await validate(links);
  if (bad.length) return { error: "Revisa estos links (no se guardó nada):", bad };

  const d = db();
  const [product] = await d.insert(schema.products).values({ canonicalName: name }).returning({ id: schema.products.id });
  const productId = product!.id;
  // Si un link ya era parte de otro producto que sigue más gente, se respeta ese producto (y lo sigues allá).
  let other: string | undefined;
  for (const ref of ok) {
    const ids = await ensureTracked(d, user.id, ref, undefined, productId);
    if (ids.productId !== productId) other ??= ids.productId;
  }
  // Si ningún link quedó en el producto nuevo (todos eran de productos compartidos), se borra el vacío.
  const kept = await d.select({ id: schema.listings.id }).from(schema.listings).where(eq(schema.listings.productId, productId)).limit(1);
  if (!kept.length) {
    await d.delete(schema.watches).where(and(eq(schema.watches.userId, user.id), eq(schema.watches.productId, productId)));
    await d.delete(schema.products).where(eq(schema.products.id, productId));
  }
  revalidatePath("/seguimientos");
  redirect(`/producto/${kept.length ? productId : other}?nuevo=1`);
}

/** Agregar otra tienda (link) a un producto que ya sigues. */
export async function addLinkToProduct(productId: string, _prev: ManualProductResult, formData: FormData): Promise<ManualProductResult> {
  const user = await getUser();
  if (!user) redirect("/login");
  const d = db();
  const watch = await d.query.watches.findFirst({
    where: and(eq(schema.watches.userId, user.id), eq(schema.watches.productId, productId), eq(schema.watches.active, true)),
  });
  if (!watch) return { error: "No sigues este producto." };

  const links = extractLinks(String(formData.get("links") ?? ""));
  if (!links.length) return { error: "Pega el link de la ficha (empieza con https://)." };
  if (links.length > MAX_LINKS) return { error: `Máximo ${MAX_LINKS} links a la vez.` };
  const { ok, bad } = await validate(links);
  if (bad.length) return { error: "Revisa estos links (no se guardó nada):", bad };

  const elsewhere: string[] = [];
  for (const ref of ok) {
    const ids = await ensureTracked(d, user.id, ref, undefined, productId);
    if (ids.productId !== productId) elsewhere.push(ref.storeName);
  }
  revalidatePath(`/producto/${productId}`);
  revalidatePath("/seguimientos");
  if (elsewhere.length) {
    return {
      error: `Agregado, pero ${elsewhere.join(", ")} ya estaba en otro producto que sigue más gente: lo sigues por separado en Mis seguimientos.`,
    };
  }
  return { ok: ok.length === 1 ? `${ok[0]!.storeName} agregada.` : `${ok.length} tiendas agregadas.` };
}

/** Cambiar el nombre de un producto creado a mano (solo si nadie más lo sigue). */
export async function renameProduct(productId: string, _prev: ManualProductResult, formData: FormData): Promise<ManualProductResult> {
  const user = await getUser();
  if (!user) redirect("/login");
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (name.length < 2) return { error: "Escribe un nombre." };
  const d = db();
  const watchers = await d
    .select({ userId: schema.watches.userId })
    .from(schema.watches)
    .where(and(eq(schema.watches.productId, productId), inArray(schema.watches.active, [true])));
  if (!watchers.some((w) => w.userId === user.id)) return { error: "No sigues este producto." };
  if (watchers.some((w) => w.userId !== user.id)) return { error: "Otra persona también sigue este producto; no se puede renombrar." };
  await d.update(schema.products).set({ canonicalName: name }).where(eq(schema.products.id, productId));
  revalidatePath(`/producto/${productId}`);
  revalidatePath("/seguimientos");
  return { ok: "Nombre guardado." };
}
