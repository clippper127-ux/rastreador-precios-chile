const rtf = new Intl.RelativeTimeFormat("es-CL", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "hace 3 horas", "ayer", "hace 2 minutos". */
export function timeAgo(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return "nunca";
  const diff = new Date(date).getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === "minute") {
      const value = Math.round(diff / ms);
      return value === 0 ? "recién" : rtf.format(value, unit);
    }
  }
  return "recién";
}

/** Un precio con más de 2 días sin chequear se considera viejo. */
export function isStale(date: Date | string | null | undefined, maxHours = 48): boolean {
  if (!date) return true;
  return Date.now() - new Date(date).getTime() > maxHours * 3_600_000;
}
