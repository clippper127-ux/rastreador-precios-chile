import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseListingUrl } from "../adapters";
import {
  classifyPriceCandidates,
  EXTENSION_STORES,
  falabellaFromNextData,
  falabellaFromSearchItem,
  genericCapture,
  sanitizeCapture,
  type PriceCandidate,
} from "./index";

const json = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"));
const c = (value: number, label = "", crossed = false, cardHint = false): PriceCandidate => ({ value, label, crossed, cardHint });
const store = (id: string) => EXTENSION_STORES.find((s) => s.id === id)!;

describe("Falabella (__NEXT_DATA__ real)", () => {
  it("evento + normal, vendedor tercero, variante del skuId de la URL", () => {
    const url = "https://www.falabella.com/falabella-cl/product/142398117/audifonos-jbl/151118204";
    const p = falabellaFromNextData(json("falabella-next-data"), url)!;
    expect(p).toMatchObject({
      sku: "151118204",
      brand: "JBL",
      priceNormal: 52988,
      priceOffer: 38990,
      stockStatus: "in_stock",
      seller: "Water. CL",
      sellerType: "third_party",
    });
    expect(p.priceCard).toBeUndefined();
    expect(p.title).toBe("Audífonos Bluetooth JBL WAVE BEAM NC Funda protectora");
  });

  it("precio CMR separado (resultado de búsqueda real)", () => {
    const p = falabellaFromSearchItem(json("falabella-cmr-search-item"));
    expect(p).toMatchObject({ priceNormal: 499990, priceOffer: 279990, priceCard: 269990, cardName: "CMR" });
  });

  it("sin productData devuelve null", () => {
    expect(falabellaFromNextData({}, "https://www.falabella.com/falabella-cl/product/1/x/2")).toBeNull();
  });
});

describe("clasificación genérica de precios visibles", () => {
  it("Paris: oferta + normal tachado", () => {
    expect(classifyPriceCandidates([c(129990), c(159990, "", true)])).toEqual({
      priceNormal: 159990,
      priceOffer: 129990,
      priceCard: undefined,
    });
  });

  it("Ripley: Normal / Internet / T. Crédito por etiqueta", () => {
    expect(
      classifyPriceCandidates([c(399990, "Normal", true), c(229990, "Internet -43%"), c(209990, "T. Crédito -48%")]),
    ).toEqual({ priceNormal: 399990, priceOffer: 229990, priceCard: 209990 });
  });

  it("candidatos reales recolectados del DOM (2026-11-24)", () => {
    // Ripley: etiquetas cortas sin "Normal"/"Internet"; normal por tachado, tarjeta por clase credit-value.
    expect(
      classifyPriceCandidates([c(399990, "$399.990", true), c(229990, "$229.990 -43%"), c(209990, "$209.990 -48%", false, true)]),
    ).toEqual({ priceNormal: 399990, priceOffer: 229990, priceCard: 209990 });
    // Paris: ambos precios comparten etiqueta; decide el tachado.
    expect(
      classifyPriceCandidates([c(129990, "19% $129.990 $159.990"), c(159990, "19% $129.990 $159.990", true)]),
    ).toEqual({ priceNormal: 159990, priceOffer: 129990, priceCard: undefined });
  });

  it("un solo precio es el normal", () => {
    expect(classifyPriceCandidates([c(49990)])).toEqual({ priceNormal: 49990, priceOffer: undefined, priceCard: undefined });
  });

  it("tarjeta por logo; descarta tarjeta que no es más barata", () => {
    expect(classifyPriceCandidates([c(100000), c(90000, "", false, true)]).priceCard).toBe(90000);
    expect(classifyPriceCandidates([c(100000), c(110000, "Tarjeta")]).priceCard).toBeUndefined();
  });

  it("ignora valores absurdos", () => {
    expect(classifyPriceCandidates([c(5), c(1_000_000_000)])).toEqual({});
  });
});

describe("captura genérica", () => {
  it("usa h1 + JSON-LD y marca vendedor tercero", () => {
    const p = genericCapture(
      {
        url: "https://www.paris.cl/x-600379999.html",
        h1: "Audífonos Bluetooth Soundcore Space One PRO ANC",
        jsonLdProduct: {
          "@type": "Product",
          name: "x",
          sku: "600379999",
          brand: { name: "Soundcore" },
          offers: [{ price: 159990, priceCurrency: "CLP" }, { price: 129990, priceCurrency: "CLP" }],
        },
        candidates: [c(129990), c(159990, "", true)],
        sellerText: "Tienda Externa SpA",
      },
      store("paris"),
    )!;
    expect(p).toMatchObject({ sku: "600379999", brand: "Soundcore", priceNormal: 159990, priceOffer: 129990, sellerType: "third_party" });
  });

  it("sin precios visibles usa el JSON-LD", () => {
    const p = genericCapture(
      { url: "https://www.lider.cl/ip/x/1", h1: "Arroz", jsonLdProduct: { "@type": "Product", offers: { price: 1990, priceCurrency: "CLP" } }, candidates: [] },
      store("lider"),
    )!;
    expect(p.priceNormal).toBe(1990);
  });
});

describe("validación del payload (backend)", () => {
  it("acepta lo correcto y descarta basura", () => {
    expect(sanitizeCapture({ url: "https://www.paris.cl/a-123456.html", title: "x", priceOffer: 1000, stockStatus: "in_stock" })).toMatchObject({
      priceOffer: 1000,
    });
    expect(sanitizeCapture({ url: "http://x", title: "x", priceOffer: 1000 })).toBeNull();
    expect(sanitizeCapture({ url: "https://www.paris.cl/a.html", title: "x", priceOffer: 10.5 })).toBeNull();
    expect(sanitizeCapture({ url: "https://www.paris.cl/a.html", title: "x", priceOffer: 1000, ean: "<script>" })?.ean).toBeUndefined();
  });
});

describe("links de tiendas de la extensión", () => {
  it("Falabella: quita sponsoredClickData y acepta la ficha", () => {
    const r = parseListingUrl(
      "https://www.falabella.com/falabella-cl/product/142398117/audifonos/142398118?sponsoredClickData=%257B",
    );
    expect(r).toEqual({
      ok: true,
      url: "https://falabella.com/falabella-cl/product/142398117/audifonos/142398118",
      storeId: "falabella",
      storeName: "Falabella",
      mode: "extension",
    });
  });
  it("Ripley y Paris", () => {
    expect(parseListingUrl("https://simple.ripley.cl/audifonos-sony-2000391128909p?color_80=Negro")).toMatchObject({
      ok: true,
      url: "https://simple.ripley.cl/audifonos-sony-2000391128909p",
    });
    expect(parseListingUrl("https://www.paris.cl/audifonos-600379999.html")).toMatchObject({ ok: true, storeId: "paris" });
    expect(parseListingUrl("https://www.paris.cl/electro/audio/")).toMatchObject({ ok: false, reason: "not_product" });
  });
});
