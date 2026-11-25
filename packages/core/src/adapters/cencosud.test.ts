import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdapterError } from "../adapter";
import { parseListingUrl } from "./index";
import { jumbo, parseCencosudProduct, parseCencosudSearch, strikePriceAfter, unitPrice } from "./cencosud";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}.html`, import.meta.url), "utf8");

describe("Jumbo / Santa Isabel (fixtures reales)", () => {
  it("producto en oferta: normal tachado, oferta, EAN y precio por unidad", () => {
    const p = parseCencosudProduct(fixture("jumbo-oferta"), "https://www.jumbo.cl/audifono-headband-2075101/p", "jumbo");
    expect(p).toMatchObject({
      title: "Audífono Headband Bluetooth Fiddler Negro",
      ean: "7809601118854",
      priceNormal: 9990,
      priceOffer: 8990,
      stockStatus: "in_stock",
      unitPrice: { price: 8990, unit: "un" },
    });
  });

  it("producto sin oferta: solo precio normal", () => {
    const p = parseCencosudProduct(fixture("santaisabel-normal"), "https://www.santaisabel.cl/x-1982451/p", "santaisabel");
    expect(p.priceNormal).toBe(7990);
    expect(p.priceOffer).toBeUndefined();
    expect(p.ean).toBe("2090001537603");
  });

  it("listado de búsqueda con nombre, precio y EAN si viene", () => {
    const r = parseCencosudSearch(fixture("jumbo-search"), "jumbo");
    expect(r.length).toBeGreaterThan(5);
    expect(r[0]).toMatchObject({ storeId: "jumbo", title: "Audífono Bluetooth Blik Soul Negro 250", priceNormal: 14990 });
    expect(r[0]!.url).toMatch(/^https:\/\/www\.jumbo\.cl\/.+\/p$/);
  });

  it("sin JSON-LD → error de parseo", () => {
    expect(() => parseCencosudProduct("<html></html>", "https://www.jumbo.cl/x/p", "jumbo")).toThrow(AdapterError);
  });

  it("utilidades", () => {
    expect(strikePriceAfter('<span class="line-through x">$<!-- -->9.990</span>', 8990)).toBe(9990);
    expect(strikePriceAfter('<span class="line-through x">$5.000</span>', 8990)).toBeUndefined();
    expect(unitPrice('<div class="ppum-price-container"><span>$1.490 x kg</span>')).toEqual({ price: 1490, unit: "kg" });
  });

  it("reconoce fichas (/p) y links pegados", () => {
    expect(jumbo.matchesUrl("https://www.jumbo.cl/arroz-grado-1-1kg-123/p")).toBe(true);
    expect(jumbo.matchesUrl("https://www.jumbo.cl/busqueda?ft=arroz")).toBe(false);
    expect(parseListingUrl("https://www.santaisabel.cl/x-1982451/p?utm_source=a")).toMatchObject({ ok: true, storeId: "santaisabel", mode: "server" });
  });
});
