const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|gbraid$|wbraid$|mc_|_ga$|ref$|srsltid$)/i;

/**
 * Normaliza la URL de un listing para que la misma ficha no se guarde dos veces:
 * https, host en minúsculas sin "www.", sin hash, sin parámetros de tracking y sin "/" final.
 */
export function normalizeListingUrl(input: string): string {
  const url = new URL(input.trim());
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

/** Dominio registrable aproximado (suficiente para tiendas .cl / .com). */
export function hostOf(input: string): string {
  return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
}

export function hostMatches(input: string, domain: string): boolean {
  try {
    const host = hostOf(input);
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}
