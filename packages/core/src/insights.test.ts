import { describe, expect, it } from "vitest";
import { activeEvent, buyOrWait, detectFakeDiscount, nextEvent } from "./insights";
import type { PriceStats, TimedSnapshot } from "./stats";

const NOW = new Date("2026-11-24T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const snap = (d: number, priceNormal: number, priceOffer?: number): TimedSnapshot => ({
  observedAt: daysAgo(d),
  priceNormal,
  priceOffer,
  stockStatus: "in_stock",
});

describe("descuento falso", () => {
  it("detecta un 'antes' inflado justo antes de la oferta", () => {
    // 80 días a $100.000; hace 5 días sube el "antes" a $150.000 y la "oferta" queda en $105.000.
    const history = [snap(80, 100000), snap(5, 150000, 105000)];
    const r = detectFakeDiscount(history, { priceNormal: 150000, priceOffer: 105000 }, NOW, NOW)!;
    expect(r.usualPrice).toBe(100000);
    expect(r.inflatedRecently).toBe(true);
    expect(r.message).toContain("no es real");
  });

  it("un descuento real no se marca", () => {
    const history = [snap(80, 100000), snap(5, 100000, 79990)];
    expect(detectFakeDiscount(history, { priceNormal: 100000, priceOffer: 79990 }, NOW, NOW)).toBeNull();
  });

  it("sin historial suficiente no acusa", () => {
    const history = [snap(10, 100000), snap(2, 150000, 105000)];
    expect(detectFakeDiscount(history, { priceNormal: 150000, priceOffer: 105000 }, NOW, NOW)).toBeNull();
  });
});

const stats = (s: Partial<PriceStats> = {}): PriceStats => ({
  min: 90000,
  max: 130000,
  median: 110000,
  p25: 100000,
  p75: 120000,
  coverageDays: 60,
  ...s,
});
const cyber = { name: "Black Friday", startsOn: new Date("2026-11-27"), endsOn: new Date("2026-11-30") };

describe("¿compro ahora o espero?", () => {
  it("faltan datos con poco historial", () => {
    expect(buyOrWait({ current: 100000, stats: stats({ coverageDays: 5 }) }).verdict).toBe("faltan_datos");
  });
  it("mínimo histórico → buen momento (aunque venga un evento)", () => {
    const r = buyOrWait({ current: 90000, stats: stats(), allTimeMin: 90000, upcoming: { event: cyber, inDays: 3 } });
    expect(r.verdict).toBe("buen_momento");
  });
  it("percentiles", () => {
    expect(buyOrWait({ current: 99000, stats: stats(), allTimeMin: 80000 }).verdict).toBe("buen_precio");
    expect(buyOrWait({ current: 115000, stats: stats(), allTimeMin: 80000 }).verdict).toBe("promedio");
    expect(buyOrWait({ current: 125000, stats: stats(), allTimeMin: 80000 }).verdict).toBe("algo_caro");
  });
  it("evento cercano → espera, con el motivo primero", () => {
    const r = buyOrWait({ current: 115000, stats: stats(), allTimeMin: 80000, upcoming: { event: cyber, inDays: 3 } });
    expect(r.verdict).toBe("espera");
    expect(r.reasons[0]).toContain("Black Friday empieza en 3 días");
  });
  it("otra tienda más barata se menciona", () => {
    expect(buyOrWait({ current: 115000, stats: stats(), allTimeMin: 80000, otherStoresMin: 105000 }).reasons.join(" ")).toContain("Otra tienda");
  });
});

describe("eventos", () => {
  const events = [cyber, { name: "CyberDay", startsOn: new Date("2027-06-07"), endsOn: new Date("2027-06-09") }];
  it("próximo y activo", () => {
    expect(nextEvent(events, NOW)).toMatchObject({ event: { name: "Black Friday" }, inDays: 3 });
    expect(activeEvent(events, new Date("2026-11-28T10:00:00Z"))?.name).toBe("Black Friday");
    expect(activeEvent(events, NOW)).toBeUndefined();
  });
});
