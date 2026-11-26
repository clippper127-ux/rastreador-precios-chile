"use server";

import { schema } from "@rastreador/db";
import { httpTransport } from "@rastreador/db/alerts";
import { notifyDealMatches, pollPublicChannels, scoreHotPosts, subscribeChannel } from "@rastreador/db/radar";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { deliveryConfig } from "@/lib/notify";
import { getUser } from "@/lib/supabase/server";
import { takeRateLimit } from "@/lib/track";

export type RadarMsg = { ok: string } | { error: string } | undefined;

async function userId() {
  const user = await getUser();
  if (!user) redirect("/login?next=/radar");
  return user.id;
}

export async function addChannel(_prev: RadarMsg, form: FormData): Promise<RadarMsg> {
  const uid = await userId();
  if (!(await takeRateLimit(db(), `radar-add:${uid}`, 10, 60))) return { error: "Espera un minuto antes de agregar más canales." };
  const r = await subscribeChannel(db(), uid, String(form.get("channel") ?? ""));
  revalidatePath("/radar");
  return "error" in r ? r : { ok: `Agregado: ${r.title}` };
}

export async function toggleSource(channelId: string, enabled: boolean): Promise<void> {
  const uid = await userId();
  await db()
    .update(schema.dealSubscriptions)
    .set({ enabled })
    .where(and(eq(schema.dealSubscriptions.userId, uid), eq(schema.dealSubscriptions.channelId, channelId)));
  revalidatePath("/radar");
}

export async function removeSource(channelId: string): Promise<void> {
  const uid = await userId();
  await db()
    .delete(schema.dealSubscriptions)
    .where(and(eq(schema.dealSubscriptions.userId, uid), eq(schema.dealSubscriptions.channelId, channelId)));
  revalidatePath("/radar");
}

export async function saveRadarPrefs(_prev: RadarMsg, form: FormData): Promise<RadarMsg> {
  const uid = await userId();
  const list = (name: string, min: number, max: number) =>
    String(form.get(name) ?? "")
      .split(/[,\n]/)
      .map((k) => k.trim().replace(/\s+/g, " ").slice(0, 60))
      .filter((k) => k.length >= min)
      .slice(0, max);
  const level = Number(form.get("hotLevel"));
  const prefs = {
    radarKeywords: list("keywords", 3, 30),
    radarPriceErrors: form.get("priceErrors") === "on",
    radarHotLevel: [0, 1, 2, 3].includes(level) ? level : 2,
    // Palabras que suman puntaje (2+ caracteres: también sirve "🔥" o "-80%").
    radarHotWords: list("hotWords", 2, 40),
  };
  await db()
    .insert(schema.profiles)
    .values({ id: uid, ...prefs })
    .onConflictDoUpdate({ target: schema.profiles.id, set: prefs });
  revalidatePath("/radar");
  return { ok: "Guardado" };
}

/** Revisar los canales ahora (máx. 1 vez por minuto por usuario). */
export async function checkRadarNow(): Promise<RadarMsg> {
  const uid = await userId();
  const d = db();
  if (!(await takeRateLimit(d, `radar-check:${uid}`, 1, 60))) return { error: "Ya revisamos hace menos de un minuto." };
  const r = await pollPublicChannels(d);
  await scoreHotPosts(d);
  const cfg = deliveryConfig();
  await notifyDealMatches(d, cfg.appUrl, httpTransport(cfg));
  revalidatePath("/radar");
  return { ok: r.newPosts ? `${r.newPosts} mensajes nuevos` : "Sin mensajes nuevos" };
}
