import { describe, expect, it } from "vitest";
import { buyLinks } from "./radar";

describe("buyLinks (links para comprar en avisos del Radar)", () => {
  it("descarta imágenes, CDNs, buscadores y Telegram; abre afiliados", () => {
    expect(
      buyLinks(
        [
          "https://easycl.vtexassets.com/arquivos/ids/1/x.jpg",
          "https://images.falabella.com/x",
          "https://cdn.tienda.cl/a",
          "https://www.google.cl/search?q=x",
          "https://t.me/canal",
          "https://ad.soicos.com/-1on8?dl=https://www.easy.cl/audifono/p",
          "https://cdnshop.cl/p",
        ],
        [],
      ),
    ).toEqual(["https://www.easy.cl/audifono/p", "https://cdnshop.cl/p"]);
  });
});
