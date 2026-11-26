import { schema } from "@rastreador/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Estado público mínimo: solo indica si cada integración está configurada (nunca muestra valores). */
export async function GET() {
  const set = (v: string | undefined) => !!v?.trim();
  // Radar en tiempo real del PC: latido de hace menos de 3 min (GitHub se salta su pasada).
  const live = await db()
    .select({ at: schema.botState.updatedAt })
    .from(schema.botState)
    .where(eq(schema.botState.id, "radar_live"))
    .catch(() => []);
  const radarLive = !!live[0] && Date.now() - live[0].at.getTime() < 3 * 60_000;
  return NextResponse.json(
    {
      ok: true,
      telegram: set(process.env.TELEGRAM_BOT_TOKEN),
      email: set(process.env.RESEND_API_KEY),
      database: set(process.env.DATABASE_URL),
      radarLive,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
