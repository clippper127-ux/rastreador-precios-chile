/**
 * Supabase ahora emite "publishable keys" (sb_publishable_...). La anon key antigua también sirve.
 * Si faltan, la app funciona sin login (útil para trabajar el diseño en local).
 */
export function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}
