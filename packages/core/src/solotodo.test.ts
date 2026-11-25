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
