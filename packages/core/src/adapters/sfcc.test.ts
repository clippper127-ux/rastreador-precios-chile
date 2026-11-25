import { readFileSync } from "node:fs";
import { AdapterError } from "../adapter";
import { describe, expect, it } from "vitest";
import { parseListingUrl } from "./index";
import { abcdin, hites, lapolar, parsePriceBlocks, parseSfccProduct, pickMainBlock } from "./sfcc";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}.html`, import.meta.url), "utf8");
const cfg = { id: "hites", cardName: "Tarjeta Hites" };

describe("SFCC · Hites (fixtures reales)", () => {
  it("producto en oferta: normal y oferta por separado", () => {
    const s = parseSfccProduct(fixture("hites-oferta"), "https://www.hites.com/x.html", cfg);
    expect(s).toMatchObject({
      title: "Audífonos Bluetooth Sonos Ace Over Ear Headphone Negros",
      brand: "SONOS",
      sku: "10063000579001",
      priceNormal: 469990,
      priceOffer: 399990,
      stockStatus: "in_stock",
      source: "server",
    });
    expect(s.priceCard).toBeUndefined();
    expect(s.imageUrl).toMatch(/^https:\/\//);
  });

  it("producto solo con precio normal: no inventa oferta", () => {
    const s = parseSfccProduct(fixture("hites-normal"), "https://www.hites.com/y.html", cfg);
    expect(s.priceNormal).toBe(13490);
    expect(s.priceOffer).toBeUndefined();
  });

  it("precios siempre enteros CLP", () => {
    const s = parseSfccProduct(fixture("hites-oferta"), "https://www.hites.com/x.html", cfg);
    for (const p of [s.priceNormal, s.priceOffer]) expect(Number.isInteger(p)).toBe(true);
  });

  it("sin JSON-LD Product lanza error de parseo (para marcar la tienda como degradada)", () => {
    expect(() => parseSfccProduct("<html><body>nada</body></html>", "https://www.hites.com/z.html", cfg)).toThrow(
      AdapterError,
    );
  });
});

describe("bloques de precio", () => {
  const html = `
    <div class="prices x"><h5 class="price-item sales "><span class="value" content="100"></span></h5>
      <span class="price-item list strike-through "><span class="value" content="150"></span></span>
      <h5 class="price-item hites-price"><span class="value" content="90"></span></h5></div>
    <div class="prices y"><h5 class="price-item sales "><span class="value" content="999"></span></h5></div>`;

  it("lee venta, lista y tarjeta", () => {
    expect(parsePriceBlocks(html)[0]).toEqual({ sales: 100, list: 150, card: 90 });
  });

  it("elige el bloque que coincide con el JSON-LD", () => {
    expect(pickMainBlock(parsePriceBlocks(html), 999)?.sales).toBe(999);
    expect(pickMainBlock(parsePriceBlocks(html))?.sales).toBe(100);
  });
});

describe("parseListingUrl (link pegado por el usuario)", () => {
  it("acepta fichas soportadas y normaliza", () => {
    const r = parseListingUrl("http://hites.com/tv-55-123.html?utm_source=ig#top");
    expect(r).toMatchObject({ ok: true, url: "https://hites.com/tv-55-123.html", storeId: "hites", mode: "server" });
  });
  it("rechaza tiendas no soportadas, no-fichas y basura", () => {
    expect(parseListingUrl("https://www.tiendainventada.cl/tv-123.html")).toMatchObject({ ok: false, reason: "unsupported" });
    expect(parseListingUrl("https://www.hites.com/busqueda")).toMatchObject({ ok: false, reason: "not_product" });
    expect(parseListingUrl("hola")).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("configuración por tienda", () => {
  it("Hites busca en servidor; La Polar y Abcdin solo por link (robots.txt)", () => {
    expect(hites.searchMode).toBe("server");
    expect(lapolar.searchMode).toBe("link");
    expect(abcdin.searchMode).toBe("link");
    expect(lapolar.search).toBeUndefined();
  });

  it("reconoce fichas de producto", () => {
    expect(hites.matchesUrl("https://www.hites.com/algo-123.html")).toBe(true);
    expect(hites.matchesUrl("https://www.hites.com/busqueda")).toBe(false);
    expect(abcdin.matchesUrl("https://www.abc.cl/tv-55-456.html")).toBe(true);
  });
});
