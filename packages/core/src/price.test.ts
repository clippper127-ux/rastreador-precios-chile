import { describe, expect, it } from "vitest";
import { bestPriceNoCard, bestPriceWithCard, formatCLP, hasPriceStateChanged, toCLP } from "./price";
import { buildSegments, computeStats, weightedPercentile } from "./stats";
import { hostMatches, normalizeListingUrl } from "./url";

describe("toCLP", () => {
  it("parsea formatos chilenos", () => {
    expect(toCLP("$1.299.990")).toBe(1299990);
    expect(toCLP("1.299.990,50")).toBe(1299990);
    expect(toCLP(49990.4)).toBe(49990);
    expect(toCLP("")).toBeUndefined();
    expect(toCLP(0)).toBeUndefined();
    expect(toCLP(null)).toBeUndefined();
  });
});

describe("formatCLP", () => {
  it("formatea sin decimales", () => {
    expect(formatCLP(1299990).replace(/\s/g, "")).toBe("$1.299.990");
    expect(formatCLP(undefined)).toBe("—");
  });
});

describe("mejor precio", () => {
  const p = { priceNormal: 599990, priceOffer: 499990, priceCard: 449990 };
  it("separa sin tarjeta y con tarjeta", () => {
    expect(bestPriceNoCard(p)).toBe(499990);
    expect(bestPriceWithCard(p)).toBe(449990);
  });
  it("con tarjeta nunca es mayor que sin tarjeta", () => {
    expect(bestPriceWithCard({ priceOffer: 100, priceCard: 120 })).toBe(100);
  });
  it("sin precios devuelve undefined", () => {
    expect(bestPriceNoCard({})).toBeUndefined();
  });
});

describe("hasPriceStateChanged", () => {
  const base = { priceOffer: 1000, stockStatus: "in_stock" as const };
  it("detecta cambios de precio y stock", () => {
    expect(hasPriceStateChanged(null, base)).toBe(true);
    expect(hasPriceStateChanged(base, { ...base })).toBe(false);
    expect(hasPriceStateChanged(base, { ...base, priceOffer: 900 })).toBe(true);
    expect(hasPriceStateChanged(base, { ...base, stockStatus: "out_of_stock" })).toBe(true);
  });
});

describe("estadísticas ponderadas por tiempo", () => {
  const d = (day: number) => new Date(Date.UTC(2026, 0, 1 + day));
  it("un precio que duró más pesa más en la mediana", () => {
    // 1 día a $100, 29 días a $200 → la mediana es $200, no $150.
    const segments = buildSegments(
      [
        { observedAt: d(0), priceOffer: 100, stockStatus: "in_stock" },
        { observedAt: d(1), priceOffer: 200, stockStatus: "in_stock" },
      ],
      d(30),
      "no_card",
    );
    const stats = computeStats(segments)!;
    expect(stats.median).toBe(200);
    expect(stats.min).toBe(100);
    expect(Math.round(stats.coverageDays)).toBe(30);
  });

  it("omite tramos sin stock y respeta la ventana", () => {
    const segments = buildSegments(
      [
        { observedAt: d(0), priceOffer: 100, stockStatus: "in_stock" },
        { observedAt: d(10), priceOffer: 100, stockStatus: "out_of_stock" },
        { observedAt: d(20), priceOffer: 300, stockStatus: "in_stock" },
      ],
      d(30),
      "no_card",
      { from: d(5) },
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]!.from).toEqual(d(5));
    expect(computeStats(segments)!.coverageDays).toBeCloseTo(15);
  });

  it("percentil vacío", () => {
    expect(weightedPercentile([], 0.5)).toBeUndefined();
  });
});

describe("URLs", () => {
  it("quita tracking, www, hash y slash final", () => {
    expect(
      normalizeListingUrl("http://WWW.Paris.cl/producto-123.html/?utm_source=x&b=2&a=1#reviews"),
    ).toBe("https://paris.cl/producto-123.html?a=1&b=2");
  });
  it("reconoce subdominios de la tienda", () => {
    expect(hostMatches("https://articulo.mercadolibre.cl/MLC-1", "mercadolibre.cl")).toBe(true);
    expect(hostMatches("https://mercadolibre.cl.evil.com/", "mercadolibre.cl")).toBe(false);
  });
});
