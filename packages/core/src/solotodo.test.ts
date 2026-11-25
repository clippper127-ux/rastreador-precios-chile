import { describe, expect, it } from "vitest";
import { offerFromEntity, type SoloTodoEntity } from "./solotodo";

// Publicación real de SoloTodo (PC Factory, 2026-11-25), recortada.
const pcf: SoloTodoEntity = {
  id: 2048052,
  name: "Consola PlayStation 5 Digital Slim ",
  store: 12,
  sku: "54253",
  ean: null,
  external_url: "https://www.pcfactory.cl/producto/54253-sony-consola-playstation-5-digital-slim",
  picture_urls: ["https://assets.pcfactory.cl/public/foto/54253/1.jpg"],
  seller: null,
  active_registry: { is_available: true, normal_price: "721690.00", offer_price: "699990.00" },
};

describe("SoloTodo → precio por tienda", () => {
  it("convierte una publicación en precio normal + precio con medio de pago", () => {
    const o = offerFromEntity(pcf, "Sony")!;
    expect(o).toMatchObject({ storeId: "pcfactory", solotodoEntityId: 2048052, priceNormal: 721690, priceCard: 699990, stockStatus: "in_stock", brand: "Sony" });
    expect(o.cardName).toBe("Medio de pago específico");
  });
  it("usa el nombre de la tarjeta de la tienda", () => {
    const o = offerFromEntity({ ...pcf, store: 30, external_url: "https://www.abcdin.cl/consola-ps5-123456.html" });
    expect(o?.cardName ?? "sin ficha reconocida").toMatch(/Tarjeta Abcdin|sin ficha/);
  });
  it("ignora tiendas que no seguimos, marketplaces y publicaciones sin precio", () => {
    expect(offerFromEntity({ ...pcf, store: 8147 })).toBeUndefined();
    expect(offerFromEntity({ ...pcf, active_registry: null })).toBeUndefined();
  });
  it("sin stock y sin precio oferta distinto", () => {
    const o = offerFromEntity({ ...pcf, active_registry: { is_available: false, normal_price: "500000", offer_price: "500000" } })!;
    expect(o.stockStatus).toBe("out_of_stock");
    expect(o.priceCard).toBeUndefined();
  });
});

describe("links de Mercado Libre", () => {
  it("acepta publicación, catálogo y producto de vendedor; limpia seguimiento", async () => {
    const { parseListingUrl } = await import("./adapters");
    const a = parseListingUrl("https://articulo.mercadolibre.cl/MLC-454613458-refrigerador-daewoo-_JM#position=1&tracking_id=x");
    expect(a).toMatchObject({ ok: true, storeId: "mercadolibre", mode: "extension", url: "https://articulo.mercadolibre.cl/MLC-454613458-refrigerador-daewoo-_JM" });
    expect(parseListingUrl("https://www.mercadolibre.cl/consola-ps5-slim/p/MLC27581930?pdp_filters=x")).toMatchObject({ ok: true, url: "https://mercadolibre.cl/consola-ps5-slim/p/MLC27581930" });
    expect(parseListingUrl("https://www.mercadolibre.cl/up/MLCU123456789")).toMatchObject({ ok: true });
    expect(parseListingUrl("https://listado.mercadolibre.cl/consola-ps5")).toMatchObject({ ok: false, reason: "not_product" });
  });
});

describe("historial de SoloTodo", () => {
  it("guarda solo los cambios, ordenados, con el medio de pago de la tienda", async () => {
    const { compactHistory } = await import("./solotodo");
    const reg = (t: string, n: string, o: string, a = true) => ({ timestamp: t, is_available: a, normal_price: n, offer_price: o });
    const pts = compactHistory(
      [
        reg("2026-09-12T10:00:00Z", "699990", "678990"),
        reg("2026-09-10T10:00:00Z", "699990", "678990"),
        reg("2026-09-11T10:00:00Z", "699990", "678990"),
        reg("2026-10-01T10:00:00Z", "649990", "649990"),
        reg("2026-10-05T10:00:00Z", "649990", "649990", false),
        reg("2026-10-06T10:00:00Z", "0", "0"),
      ],
      9,
    );
    expect(pts.map((p) => [p.observedAt.toISOString().slice(0, 10), p.priceNormal, p.priceCard ?? null, p.stockStatus])).toEqual([
      ["2026-09-10", 699990, 678990, "in_stock"],
      ["2026-10-01", 649990, null, "in_stock"],
      ["2026-10-05", 649990, null, "out_of_stock"],
    ]);
    expect(pts[0]!.cardName).toBe("Tarjeta CMR");
  });
});
