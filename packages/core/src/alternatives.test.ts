import { describe, expect, it } from "vitest";
import { alternativeQuery, pickAlternatives } from "./alternatives";
import type { ResultGroup } from "./search";

describe("alternativeQuery", () => {
  it("quita marca y modelo, deja tipo y medidas", () => {
    expect(alternativeQuery("Audífonos Sony WH-1000XM5 Bluetooth Negro", "Sony")).toBe("audifonos bluetooth");
    expect(alternativeQuery('Smart TV Samsung 55" Crystal UHD 4K', "Samsung")).toBe('smart tv 4k 55"');
    expect(alternativeQuery("Detergente Líquido Omo 3 L", "Omo")).toBe("detergente liquido 3 L");
  });
  it("sin tipo reconocible", () => {
    expect(alternativeQuery("XM5 1000", null)).toBeUndefined();
  });
});

const g = (title: string, price: number, url: string): ResultGroup => ({
  key: url,
  title,
  items: [{ storeId: "x", url, title, priceNormal: price, stockStatus: "in_stock", bestNoCard: price }],
  bestNoCard: price,
  relevance: 1,
  variant: [],
});

describe("pickAlternatives", () => {
  const current = { name: "Audífonos Sony WH-1000XM5 Bluetooth", urls: ["https://a/1"], bestNoCard: 300000 };
  it("solo más baratas, sin el mismo producto, ordenadas", () => {
    const out = pickAlternatives(
      [
        g("Audífonos JBL Tune 770NC Bluetooth", 89990, "https://b/1"),
        g("Audífonos Sony WH-1000XM5 Bluetooth", 280000, "https://c/1"), // mismo producto en otra tienda
        g("Audífonos Bose QC45 Bluetooth", 250000, "https://d/1"),
        g("Audífonos Sennheiser Momentum 4", 320000, "https://e/1"), // más caro
        g("Audífonos Sony WH-1000XM5", 299000, "https://a/1"), // mismo link
      ],
      current,
    );
    expect(out.map((x) => x.bestNoCard)).toEqual([89990, 250000]);
    expect(out.every((x) => !x.maybeSame)).toBe(true);
  });
});
