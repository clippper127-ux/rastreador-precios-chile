import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSfccSearch } from "./adapters/sfcc";
import { groupResults, isValidEan, parseQuery, relevance, sameProduct, tokenize } from "./search";
import type { SearchResult } from "./types";

const r = (storeId: string, title: string, price: number, extra: Partial<SearchResult> = {}): SearchResult => ({
  storeId,
  url: `https://${storeId}.cl/${encodeURIComponent(title)}`,
  title,
  priceNormal: price,
  stockStatus: "in_stock",
  ...extra,
});

describe("texto", () => {
  it("normaliza tildes, plurales y modelos", () => {
    expect(tokenize("Audífonos Sony WH-1000XM5 Inalámbricos")).toEqual(["audifono", "sony", "wh1000xm5", "inalambrico"]);
    expect(tokenize("iPhone 15 128 GB")).toEqual(["iphone", "15", "128gb"]);
    expect(parseQuery("PS5 Slim con lector").tokens).toEqual(["ps5", "slim", "lector"]);
  });

  it("relevancia: modelo obligatorio", () => {
    const q = parseQuery("sony wh-1000xm5");
    expect(relevance(q, "Audífonos Sony WH 1000XM5 Bluetooth")).toBe(1);
    expect(relevance(q, "Audífonos Sony WH-CH720N")).toBe(0);
  });
});

describe("mismo producto entre tiendas", () => {
  it("por EAN", () => {
    expect(sameProduct(r("a", "x", 1, { ean: "123" }), r("b", "y", 1, { ean: "123" }))).toBe(true);
    expect(sameProduct(r("a", "Sony XM5", 1, { ean: "123" }), r("b", "Sony XM5", 1, { ean: "999" }))).toBe(false);
  });
  it("por marca + modelo + título", () => {
    expect(
      sameProduct(r("paris", "Audífonos Bluetooth Sony WH-1000XM5 Negro", 1, { brand: "Sony" }), r("ripley", "AUDÍFONOS SONY WH 1000XM5 BLUETOOTH", 1)),
    ).toBe(true);
  });
  it("títulos reales de Ripley y Hites (2026-11-24): mismo modelo con y sin letra final", () => {
    expect(
      sameProduct(
        r("ripley", "AUDÍFONOS INALÁMBRICOS CON CANCELACIÓN DE RUIDO WH-CH720 NEGRO", 1),
        r("hites", "Audífonos Bluetooth Sony WH-CH720N", 1, { brand: "SONY" }),
      ),
    ).toBe(true);
    expect(sameProduct(r("ripley", "AUDÍFONOS SONY WF-C510 BLUETOOTH", 1), r("hites", "Audífonos Bluetooth Sony WH-CH720N", 1))).toBe(false);
  });

  it("no junta capacidades ni marcas distintas", () => {
    expect(sameProduct(r("a", "iPhone 15 128GB Negro", 1, { brand: "Apple" }), r("b", "iPhone 15 256GB Negro", 1, { brand: "Apple" }))).toBe(false);
    expect(sameProduct(r("a", "Audífonos Bluetooth Negro", 1, { brand: "JBL" }), r("b", "Audífonos Bluetooth Negro", 1, { brand: "Sony" }))).toBe(false);
  });
});

describe("agrupación", () => {
  it("agrupa entre tiendas, no repite tienda, ordena por precio y filtra irrelevantes", () => {
    const groups = groupResults(
      [
        r("paris", "Audífonos Sony WH-1000XM5 Negro", 299990, { brand: "Sony" }),
        r("ripley", "AUDÍFONOS SONY WH 1000XM5 BLUETOOTH", 229990),
        r("paris", "Audífonos Sony WH-1000XM5 Azul", 309990, { brand: "Sony" }),
        r("hites", "Cargador USB-C 20W", 9990),
      ],
      parseQuery("sony wh1000xm5"),
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items.map((i) => i.storeId)).toEqual(["ripley", "paris"]);
    expect(groups[0]!.bestNoCard).toBe(229990);
  });
});

describe("listado de búsqueda de Hites (fixture real)", () => {
  const html = readFileSync(new URL("./adapters/__fixtures__/hites-search.html", import.meta.url), "utf8");
  const results = parseSfccSearch(html, { id: "hites", domain: "hites.com", cardName: "Tarjeta Hites" });

  it("lee nombre, marca, precios y vendedor de cada producto", () => {
    expect(results.length).toBeGreaterThanOrEqual(6);
    const sonos = results.find((x) => /sonos/i.test(x.title))!;
    expect(sonos).toMatchObject({ priceNormal: 469990, priceOffer: 399990, storeId: "hites" });
    expect(sonos.url).toMatch(/^https:\/\/www\.hites\.com\/.+\.html$/);
    const ps3 = results.find((x) => /ps3/i.test(x.title))!;
    expect(ps3).toMatchObject({ priceNormal: 13490, seller: "PuntoStore", sellerType: "third_party" });
    expect(ps3.title).toContain("Audífonos");
  });

  it("variantes de color de la misma tienda quedan separadas", () => {
    const akai = groupResults(results, parseQuery("akai air zen")).filter((g) => /akai/i.test(g.title));
    expect(akai.length).toBeGreaterThanOrEqual(2);
    expect(akai.every((g) => g.items.length === 1)).toBe(true);
  });
});

describe("búsqueda por código de barras", () => {
  it("valida EAN con dígito verificador", () => {
    expect(isValidEan("7809601118854")).toBe(true); // Jumbo, real
    expect(isValidEan("7804652331504")).toBe(true); // Jumbo, real
    expect(isValidEan("7809601118855")).toBe(false);
    expect(isValidEan("12345")).toBe(false);
  });
  it("agrupa por EAN y descarta otros EAN", () => {
    const groups = groupResults(
      [
        r("jumbo", "Audífono Headband Bluetooth Fiddler Negro", 8990, { ean: "7809601118854" }),
        r("lider", "Audífonos Fiddler Headband", 9490),
        r("jumbo", "Otro producto", 1000, { ean: "7804652331504" }),
      ],
      parseQuery("7809601118854"),
    );
    expect(groups.flatMap((g) => g.items.map((i) => i.storeId))).toEqual(["jumbo", "lider"]);
  });
});
