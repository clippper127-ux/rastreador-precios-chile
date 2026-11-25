import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino del link del correo (magic link y confirmación de registro).
 * Usa `token_hash` en vez de PKCE: funciona aunque el correo se abra en otro navegador o dispositivo.
 * Las plantillas de correo de Supabase deben apuntar aquí (ver README → "Correos de acceso").
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash) {
    const supabase = await createClient();
    const result = await supabase?.auth.verifyOtp({ type, token_hash: tokenHash });
    if (result && !result.error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
