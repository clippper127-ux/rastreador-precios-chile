import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Estado público mínimo: solo indica si cada integración está configurada (nunca muestra valores). */
export function GET() {
  const set = (v: string | undefined) => !!v?.trim();
  return NextResponse.json(
    {
      ok: true,
      telegram: set(process.env.TELEGRAM_BOT_TOKEN),
      email: set(process.env.RESEND_API_KEY),
      database: set(process.env.DATABASE_URL),
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
