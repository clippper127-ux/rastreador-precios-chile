import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/** Destino del magic link y de Google: intercambia el código por una sesión. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = (await supabase?.auth.exchangeCodeForSession(code)) ?? { error: true };
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    // Sin el "code verifier" (cookie del navegador donde se pidió el link) el intercambio falla.
    return NextResponse.redirect(`${origin}/login?error=browser`);
  }
  // Supabase devuelve error=access_denied&error_code=otp_expired cuando el link ya se usó o venció.
  return NextResponse.redirect(`${origin}/login?error=link`);
}
