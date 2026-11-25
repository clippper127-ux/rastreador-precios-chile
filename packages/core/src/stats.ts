import { effectivePrice, type PriceBasis, type PriceState } from "./price";
import type { CLP } from "./types";

/**
 * El historial solo guarda cambios, así que cada precio "vale" por el tiempo que estuvo vigente.
 * Todas las estadísticas se ponderan por duración; si no, un precio de 1 hora pesaría igual que uno de 2 meses.
 */
export interface PriceSegment {
  price: CLP;
  from: Date;
  to: Date;
}

export interface TimedSnapshot extends PriceState {
  observedAt: Date;
}

const DAY_MS = 86_400_000;

/**
 * Convierte snapshots (ordenados o no) en tramos de precio.
 * El último tramo se cierra en `lastCheckedAt`: no sabemos qué pasó después del último chequeo.
 * Los tramos sin stock o sin precio se omiten.
 */
export function buildSegments(
  snapshots: TimedSnapshot[],
  lastCheckedAt: Date,
  basis: PriceBasis,
  window?: { from: Date },
): PriceSegment[] {
  const sorted = [...snapshots].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const segments: PriceSegment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const next = sorted[i + 1];
    let from = s.observedAt;
    const to = next ? next.observedAt : lastCheckedAt;
    if (window && to <= window.from) continue;
    if (window && from < window.from) from = window.from;
    if (to <= from) continue;
    if (s.stockStatus === "out_of_stock" || s.stockStatus === "discontinued") continue;
    const price = effectivePrice(s, basis);
    if (price == null) continue;
    segments.push({ price, from, to });
  }
  return segments;
}

export interface PriceStats {
  min: CLP;
  max: CLP;
  median: CLP;
  p25: CLP;
  p75: CLP;
  /** Días con precio conocido dentro del período. Se usa para "Faltan datos" (mínimo 14). */
  coverageDays: number;
}

/** Percentil ponderado por duración (q entre 0 y 1). */
export function weightedPercentile(segments: PriceSegment[], q: number): CLP | undefined {
  if (!segments.length) return undefined;
  const items = segments
    .map((s) => ({ price: s.price, w: s.to.getTime() - s.from.getTime() }))
    .filter((i) => i.w > 0)
    .sort((a, b) => a.price - b.price);
  const total = items.reduce((acc, i) => acc + i.w, 0);
  if (total === 0) return undefined;
  const target = q * total;
  let acc = 0;
  for (const i of items) {
    acc += i.w;
    if (acc >= target) return i.price;
  }
  return items[items.length - 1]!.price;
}

export function computeStats(segments: PriceSegment[]): PriceStats | null {
  if (!segments.length) return null;
  const prices = segments.map((s) => s.price);
  const coverageMs = segments.reduce((acc, s) => acc + (s.to.getTime() - s.from.getTime()), 0);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    median: weightedPercentile(segments, 0.5)!,
    p25: weightedPercentile(segments, 0.25)!,
    p75: weightedPercentile(segments, 0.75)!,
    coverageDays: coverageMs / DAY_MS,
  };
}

export const MIN_COVERAGE_DAYS_FOR_VERDICT = 14;
