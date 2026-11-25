import { AdapterError, isAllowed, looksBlocked, parseRobots, type RobotsRules } from "@rastreador/core";
import { env } from "./env";

/**
 * Cliente HTTP "educado" del worker:
 * - User-Agent honesto.
 * - Respeta robots.txt (cacheado por host) y su Crawl-delay.
 * - Espera mínima entre requests al mismo host (por defecto 3 s).
 * - Timeout y detección de bloqueo (403/429/desafío) → AdapterError("blocked").
 * Nada de reintentos agresivos: el backoff lo decide quien llama.
 */
const robotsCache = new Map<string, Promise<RobotsRules>>();
const lastRequestAt = new Map<string, number>();

const DEFAULT_DELAY_MS = 3_000;
const TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function robotsFor(origin: string): Promise<RobotsRules> {
  let p = robotsCache.get(origin);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`${origin}/robots.txt`, {
          headers: { "user-agent": env.userAgent },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { allow: [], disallow: [] };
        return parseRobots(await res.text(), env.userAgent);
      } catch {
        return { allow: [], disallow: [] };
      }
    })();
    robotsCache.set(origin, p);
  }
  return p;
}

async function waitTurn(host: string, minDelayMs: number) {
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + minDelayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

export interface PoliteFetchOptions extends RequestInit {
  storeId?: string;
  minDelayMs?: number;
  /** Para APIs oficiales con sus propios términos (no aplica robots.txt de un sitio web). */
  skipRobots?: boolean;
}

export async function politeFetch(url: string, opts: PoliteFetchOptions = {}): Promise<Response> {
  const u = new URL(url);
  if (!opts.skipRobots) {
    const rules = await robotsFor(u.origin);
    if (!isAllowed(rules, u.pathname + u.search)) {
      throw new AdapterError("blocked", `robots.txt no permite ${u.pathname}`, opts.storeId);
    }
    const crawlDelayMs = (rules.crawlDelaySec ?? 0) * 1000;
    await waitTurn(u.host, Math.max(opts.minDelayMs ?? DEFAULT_DELAY_MS, crawlDelayMs));
  } else {
    await waitTurn(u.host, opts.minDelayMs ?? 1_000);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...opts,
      redirect: "follow",
      headers: {
        "user-agent": env.userAgent,
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "es-CL,es;q=0.9",
        ...opts.headers,
      },
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = (err as Error).name === "TimeoutError";
    throw new AdapterError(timeout ? "timeout" : "network", (err as Error).message, opts.storeId);
  }

  if (looksBlocked(res.status)) {
    throw new AdapterError("blocked", `HTTP ${res.status}`, opts.storeId, res.status);
  }
  return res;
}

/** Igual que politeFetch, pero lee el HTML y detecta páginas de desafío con status 200. */
export async function politeFetchText(url: string, opts: PoliteFetchOptions = {}): Promise<{ res: Response; text: string }> {
  const res = await politeFetch(url, opts);
  const text = await res.text();
  if (looksBlocked(res.status, text) && !/<script[^>]*ld\+json/i.test(text)) {
    throw new AdapterError("blocked", "Página de desafío / anti-bot", opts.storeId, res.status);
  }
  return { res, text };
}
