/** Evita redirecciones abiertas: solo rutas internas. */
export function safeNext(next: string | null | undefined, fallback = "/seguimientos"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
