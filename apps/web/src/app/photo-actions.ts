"use server";

import { isValidEan } from "@rastreador/core";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getUser } from "@/lib/supabase/server";
import { takeRateLimit } from "@/lib/track";
import { identifyProduct, visionEnabled } from "@/lib/vision";

export type PhotoResult = { query: string; confidence: string } | { error: string };

const MAX_BYTES = 2_000_000; // el navegador ya la reduce a ~1280 px en JPEG

/** Identifica el producto de una foto con Gemini (solo si hay LLM_API_KEY). Máx. 10 fotos por hora. */
export async function identifyPhoto(form: FormData): Promise<PhotoResult> {
  const user = await getUser();
  if (!user) redirect("/login?next=/");
  if (!visionEnabled()) return { error: "El reconocimiento de fotos no está activado (falta LLM_API_KEY)." };
  if (!(await takeRateLimit(db(), `photo:${user.id}`, 10, 3600))) return { error: "Llegaste al máximo de 10 fotos por hora." };

  const file = form.get("photo");
  if (!(file instanceof File) || !/^image\/(jpeg|png|webp)$/.test(file.type)) return { error: "Sube una imagen JPG, PNG o WebP." };
  if (file.size > MAX_BYTES) return { error: "La imagen es muy grande." };

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const guess = await identifyProduct(base64, file.type);
    if (!guess) return { error: "No reconocimos un producto en la foto. Prueba con otra más cerca o escríbelo." };
    // Si Gemini leyó un código de barras válido, buscar por él es lo más preciso.
    if (guess.ean && isValidEan(guess.ean)) return { query: guess.ean, confidence: "alta" };
    return { query: guess.query, confidence: guess.confidence };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
