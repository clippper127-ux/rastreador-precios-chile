import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSfccSearch } from "./adapters/sfcc";
import { groupResults, isValidEan, matchesQuery, measureLabel, parseQuery, relevance, sameProduct, tokenize, variantChoices, variantOf } from "./search";
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

describe("búsqueda exacta (consola ps5, 2026-11-25)", () => {
  const q = parseQuery("consola ps5");
  it("acepta la consola con cualquier forma de escribir PlayStation 5", () => {
    expect(matchesQuery(q, "Consola PlayStation 5 Slim Digital 1TB", "Sony")).toBe(true);
    expect(matchesQuery(q, "Consola PS5 Slim Estándar + Control", "PlayStation")).toBe(true);
    expect(matchesQuery(q, "Consolas Play Station 5 Pro")).toBe(true);
  });
  it("descarta bolsos, juegos, controles y accesorios", () => {
    expect(matchesQuery(q, "Bolso para PS5 Gris")).toBe(false);
    expect(matchesQuery(q, "Juego Marvel's Spider-Man 2 PS5", "Sony")).toBe(false);
    expect(matchesQuery(q, "Control DualSense PS5 Blanco", "Sony")).toBe(false);
    expect(matchesQuery(q, "Base Cargadora Soporte para Consola PS5")).toBe(false);
    expect(matchesQuery(q, "Funda Protectora Consola PS5")).toBe(false);
  });
  it("si buscas el accesorio, aparece", () => {
    expect(matchesQuery(parseQuery("control ps5"), "Control DualSense PS5 Blanco")).toBe(true);
    expect(matchesQuery(parseQuery("bolso ps5"), "Bolso para PS5 Gris")).toBe(true);
  });
  it("no rompe búsquedas comunes", () => {
    expect(matchesQuery(parseQuery("sony wh1000xm5"), "Audífonos Sony WH-1000XM5 Bluetooth")).toBe(true);
    expect(matchesQuery(parseQuery("sabanas 2 plazas"), "Juego de Sábanas 2 Plazas 144 Hilos")).toBe(true);
    expect(matchesQuery(parseQuery("nutella"), "Crema de Avellana Nutella 200 g")).toBe(true);
    // Consultas largas toleran una palabra genérica ausente, nunca un modelo.
    expect(matchesQuery(parseQuery("smart tv samsung 55 crystal"), "Televisor Samsung 55\" Crystal UHD 4K")).toBe(true);
    expect(matchesQuery(parseQuery("smart tv samsung 65 crystal"), "Televisor Samsung 55\" Crystal UHD 4K")).toBe(false);
  });
  it("groupResults oculta lo no exacto salvo con loose", () => {
    const rs: SearchResult[] = [
      { storeId: "hites", url: "https://a/1", title: "Consola PlayStation 5 Slim", priceNormal: 499990, stockStatus: "in_stock" },
      { storeId: "hites", url: "https://a/2", title: "Bolso para PS5", priceNormal: 19990, stockStatus: "in_stock" },
    ];
    expect(groupResults(rs, q).map((g) => g.title)).toEqual(["Consola PlayStation 5 Slim"]);
    expect(groupResults(rs, q, { loose: true })).toHaveLength(2);
  });
});

describe("medidas y versiones", () => {
  it("normaliza unidades escritas de distintas formas", () => {
    expect(variantOf("Nutella 400 gr")).toEqual(["400g"]);
    expect(variantOf("Nutella 0,4 Kg")).toEqual(["400g"]);
    expect(variantOf("Coca-Cola 1,5 Lt")).toEqual(["1500ml"]);
    expect(variantOf("Bebida 1500 cc")).toEqual(["1500ml"]);
    expect(variantOf("Disco SSD 1TB")).toEqual(["1000gb"]);
    expect(variantOf("Consola PS5 Edición Digital 825 GB")).toEqual(["825gb"]);
    expect(variantOf('Smart TV Samsung 55" Crystal')).toEqual(["55pulg"]);
    expect(variantOf("Televisor LG 65 pulgadas")).toEqual(["65pulg"]);
    expect(variantOf("Cerveza pack 6 latas")).toEqual(["6un"]);
    expect(variantOf("Samsung Galaxy A55 5G 8GB 256GB")).toEqual(["8gb", "256gb"]);
  });
  it("etiquetas legibles", () => {
    expect(["400g", "1000g", "1500ml", "250ml", "1000gb", "825gb", "55pulg", "6un"].map(measureLabel)).toEqual([
      "400 g", "1 kg", "1,5 L", "250 ml", "1 TB", "825 GB", '55"', "6 un.",
    ]);
  });
  it("si escribes la versión, solo esa (1 kg = 1000 g; 200 g no es 1200 g)", () => {
    const q = parseQuery("nutella 1 kg");
    expect(matchesQuery(q, "Crema Nutella 1000 g")).toBe(true);
    expect(matchesQuery(q, "Crema Nutella 750 g")).toBe(false);
    expect(matchesQuery(parseQuery("nutella 200g"), "Nutella 1200 g")).toBe(false);
    expect(matchesQuery(parseQuery("nutella 200g"), "Crema Nutella 200 gr")).toBe(true);
  });
  it("no agrupa versiones distintas entre tiendas", () => {
    const a = { storeId: "jumbo", url: "https://a/1", title: "Nutella 200 g", brand: "Nutella", stockStatus: "in_stock" as const };
    expect(sameProduct(a, { ...a, storeId: "santa-isabel", url: "https://b/1", title: "Crema Nutella 0,2 kg" })).toBe(true);
    expect(sameProduct(a, { ...a, storeId: "santa-isabel", url: "https://b/2", title: "Crema Nutella 350 g" })).toBe(false);
  });
});

describe("elige la versión", () => {
  const r = (title: string, n: number) => ({ storeId: "jumbo", url: `https://a/${n}`, title, stockStatus: "in_stock" as const });
  const rs = [r("Nutella 200 g", 1), r("Nutella 350 gr", 2), r("Nutella 1 kg", 3), r("Nutella Go 52 g", 4)];
  it("ofrece las versiones encontradas, de menor a mayor", () => {
    const q = parseQuery("nutella");
    expect(variantChoices(groupResults(rs, q), q).map((c) => c.label)).toEqual(["52 g", "200 g", "350 g", "1 kg"]);
  });
  it("al elegir una, solo esa y ya no se ofrecen chips", () => {
    const q = parseQuery("nutella 1 kg");
    const g = groupResults(rs, q);
    expect(g.map((x) => x.title)).toEqual(["Nutella 1 kg"]);
    expect(variantChoices(g, q)).toEqual([]);
  });
});
