import { effectivePrice, formatCLP, type PriceBasis } from "./price";
import { buildSegments, computeStats, MIN_COVERAGE_DAYS_FOR_VERDICT, type PriceStats, type TimedSnapshot } from "./stats";
import type { CLP } from "./types";

/*
 * Funciones de valor (Fase 7), todas explicables y sin "predicciones mágicas":
 * - detector de descuento falso,
 * - veredicto "¿compro ahora o espero?",
 * - calendario de eventos de descuento.
 */

const DAY = 86_400_000;

// ─── Descuento falso ─────────────────────────────────────────────────────────

export interface FakeDiscount {
  /** "Antes" que muestra la tienda hoy. */
  shownBefore: CLP;
  /** Precio habitual real: mediana ponderada de lo que se pagó en 60–90 días (sin contar el precio de hoy). */
  usualPrice: CLP;
  /** El "antes" subió en los últimos 30 días (inflado justo antes de la "oferta"). */
  inflatedRecently: boolean;
  message: string;
}

/**
 * Compara el "antes" de la tienda con lo que realmente costó. Avisa si el "antes" está ≥10 % sobre el
 * precio habitual real. Requiere 14+ días de historial previo para no acusar sin evidencia.
 */
export function detectFakeDiscount(
  snapshots: TimedSnapshot[],
  current: { priceNormal?: CLP; priceOffer?: CLP },
  lastCheckedAt: Date,
  now = new Date(),
): FakeDiscount | null {
  const shownBefore = current.priceNormal;
  if (shownBefore == null || current.priceOffer == null || current.priceOffer >= shownBefore) return null;

  // Historial ANTES de la oferta actual: excluye el último tramo (el de hoy).
  const sorted = [...snapshots].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const last = sorted[sorted.length - 1];
  const history = last && last.priceOffer === current.priceOffer ? sorted.slice(0, -1) : sorted;
  if (!history.length) return null;
  const until = last && history.length < sorted.length ? last.observedAt : lastCheckedAt;
  const window = { from: new Date(now.getTime() - 90 * DAY) };
  const stats = computeStats(buildSegments(history, until, "no_card", window));
  if (!stats || stats.coverageDays < MIN_COVERAGE_DAYS_FOR_VERDICT) return null;

  if (shownBefore < stats.median * 1.1) return null;
  const monthAgo = now.getTime() - 30 * DAY;
  const oldNormals = history.filter((s) => s.observedAt.getTime() < monthAgo && s.priceNormal != null).map((s) => s.priceNormal!);
  const inflatedRecently = oldNormals.length > 0 && shownBefore > Math.max(...oldNormals);
  return {
    shownBefore,
    usualPrice: stats.median,
    inflatedRecently,
    message: `Este descuento no es real: el precio habitual era ${formatCLP(stats.median)}, no ${formatCLP(shownBefore)}${
      inflatedRecently ? " (el “antes” subió hace poco)" : ""
    }.`,
  };
}

// ─── Eventos de descuento ────────────────────────────────────────────────────

export interface SaleEvent {
  name: string;
  startsOn: Date;
  endsOn: Date;
}

export function activeEvent(events: SaleEvent[], now = new Date()): SaleEvent | undefined {
  return events.find((e) => e.startsOn.getTime() <= now.getTime() && now.getTime() < e.endsOn.getTime() + DAY);
}

export function nextEvent(events: SaleEvent[], now = new Date()): { event: SaleEvent; inDays: number } | undefined {
  const next = events
    .filter((e) => e.startsOn.getTime() > now.getTime())
    .sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime())[0];
  return next ? { event: next, inDays: Math.ceil((next.startsOn.getTime() - now.getTime()) / DAY) } : undefined;
}

// ─── ¿Compro ahora o espero? ─────────────────────────────────────────────────

export type Verdict = "buen_momento" | "buen_precio" | "promedio" | "algo_caro" | "espera" | "faltan_datos";

export const VERDICT_LABEL: Record<Verdict, string> = {
  buen_momento: "Buen momento para comprar",
  buen_precio: "Buen precio",
  promedio: "Precio promedio",
  algo_caro: "Algo caro",
  espera: "Mejor espera",
  faltan_datos: "Faltan datos",
};

export interface VerdictInput {
  /** Mejor precio actual (según la base elegida). */
  current?: CLP;
  /** Estadísticas ponderadas por tiempo de los últimos 90 días del mejor listing. */
  stats: PriceStats | null;
  /** Mínimo histórico (todo el historial, todas las tiendas). */
  allTimeMin?: CLP;
  /** Mejor precio actual en otras tiendas del mismo producto. */
  otherStoresMin?: CLP;
  fakeDiscount?: FakeDiscount | null;
  upcoming?: { event: SaleEvent; inDays: number };
}

export interface VerdictResult {
  verdict: Verdict;
  label: string;
  reasons: string[];
}

/**
 * Reglas, en orden:
 * 1. <14 días de historial → "Faltan datos".
 * 2. En (o a 2 % de) su mínimo histórico → "Buen momento".
 * 3. Bajo el percentil 25 de 90 días → "Buen precio"; hasta el 75 → "Promedio"; sobre eso → "Algo caro".
 * 4. Si no es "Buen momento" y viene un evento en ≤21 días → "Mejor espera".
 * 5. Un descuento falso nunca puede subir el veredicto a "Buen momento".
 */
export function buyOrWait(i: VerdictInput): VerdictResult {
  const reasons: string[] = [];
  const done = (verdict: Verdict): VerdictResult => ({ verdict, label: VERDICT_LABEL[verdict], reasons });

  if (i.current == null) return done("faltan_datos");
  if (!i.stats || i.stats.coverageDays < MIN_COVERAGE_DAYS_FOR_VERDICT) {
    reasons.push(`Necesitamos ${MIN_COVERAGE_DAYS_FOR_VERDICT} días de historial; llevamos ${Math.floor(i.stats?.coverageDays ?? 0)}.`);
    if (i.upcoming && i.upcoming.inDays <= 21) reasons.push(`${i.upcoming.event.name} empieza en ${i.upcoming.inDays} días.`);
    return done("faltan_datos");
  }

  const { p25, p75, median } = i.stats;
  let verdict: Verdict;
  if (i.allTimeMin != null && i.current <= i.allTimeMin * 1.02 && !i.fakeDiscount) {
    verdict = "buen_momento";
    reasons.push(i.current <= i.allTimeMin ? "Está en su mínimo histórico." : `Está a menos de 2 % de su mínimo histórico (${formatCLP(i.allTimeMin)}).`);
  } else if (i.current <= p25) {
    verdict = "buen_precio";
    reasons.push(`Está entre el 25 % de precios más bajos de los últimos 90 días (habitual ${formatCLP(median)}).`);
  } else if (i.current <= p75) {
    verdict = "promedio";
    reasons.push(`Está cerca de su precio habitual (${formatCLP(median)}).`);
  } else {
    verdict = "algo_caro";
    reasons.push(`Está sobre lo habitual: suele costar ${formatCLP(median)}.`);
  }

  if (i.otherStoresMin != null && i.otherStoresMin < i.current) {
    reasons.push(`Otra tienda lo tiene más barato: ${formatCLP(i.otherStoresMin)}.`);
  }
  if (i.fakeDiscount) reasons.push(i.fakeDiscount.message);

  if (verdict !== "buen_momento" && i.upcoming && i.upcoming.inDays <= 21) {
    reasons.unshift(`${i.upcoming.event.name} empieza en ${i.upcoming.inDays} días: suele haber mejores precios.`);
    verdict = "espera";
  }
  return done(verdict);
}

/** Atajo: precio efectivo de un set de precios según la base elegida. */
export function priceFor(p: { priceNormal?: CLP; priceOffer?: CLP; priceCard?: CLP }, basis: PriceBasis) {
  return effectivePrice(p, basis);
}
