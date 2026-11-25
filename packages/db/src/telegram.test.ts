import { describe, expect, it } from "vitest";
import { urlsInMessage } from "./telegram";

describe("links en mensajes de Telegram (ofertas reenviadas)", () => {
  it("toma URLs en texto, en entidades y en links con texto", () => {
    const text = "🔥 ERROR DE PRECIO 🔥 PS5 a $199.990 → https://www.paris.cl/ps5-600379999.html. ¡Corre! Ver oferta";
    const urls = urlsInMessage({
      text,
      entities: [{ type: "text_link", offset: text.indexOf("Ver oferta"), length: 10, url: "https://bit.ly/abc123" }],
    });
    expect(urls).toEqual(["https://bit.ly/abc123", "https://www.paris.cl/ps5-600379999.html"]);
  });

  it("lee el caption de fotos y agrega https a dominios sin esquema", () => {
    const caption = "Oferta: falabella.com/falabella-cl/product/1/x/2";
    expect(
      urlsInMessage({ caption, caption_entities: [{ type: "url", offset: 8, length: caption.length - 8 }] }),
    ).toEqual(["https://falabella.com/falabella-cl/product/1/x/2"]);
  });

  it("máximo 5 links por mensaje", () => {
    const text = Array.from({ length: 8 }, (_, i) => `https://t.co/${i}`).join(" ");
    expect(urlsInMessage({ text })).toHaveLength(5);
  });
});
