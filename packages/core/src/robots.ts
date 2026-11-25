/**
 * Lector mínimo de robots.txt: reglas del grupo que aplica a nuestro User-Agent (o "*"),
 * con la regla más específica (más larga) ganando y Allow ganando en empate. Soporta "*" y "$".
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelaySec?: number;
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.rules.allow.push(value);
    else if (field === "disallow" && value) current.rules.disallow.push(value);
    else if (field === "crawl-delay") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) current.rules.crawlDelaySec = n;
    }
  }

  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const wildcard = groups.filter((g) => g.agents.includes("*"));
  if (specific) return specific.rules;
  return {
    allow: wildcard.flatMap((g) => g.rules.allow),
    disallow: wildcard.flatMap((g) => g.rules.disallow),
    crawlDelaySec: wildcard.find((g) => g.rules.crawlDelaySec != null)?.rules.crawlDelaySec,
  };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** ¿Podemos pedir esta ruta (path + query)? */
export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  const consider = (patterns: string[], allow: boolean) => {
    for (const p of patterns) {
      if (patternToRegex(p).test(pathAndQuery)) {
        const len = p.length;
        if (!best || len > best.len || (len === best.len && allow)) best = { len, allow };
      }
    }
  };
  consider(rules.disallow, false);
  consider(rules.allow, true);
  return best ? (best as { allow: boolean }).allow : true;
}
