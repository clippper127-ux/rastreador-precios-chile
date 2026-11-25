import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeDealText, channelHandle, htmlToText, matchDeal, parseChannelPage, storeLinks } from "./index";

describe("canales públicos (t.me/s)", () => {
  it("lee mensajes reales: id, fecha y texto", () => {
    const html = readFileSync(new URL("./__fixtures__/tme-telegram.html", import.meta.url), "utf8");
    const { posts } = parseChannelPage(html, "telegram");
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts[0]!.id).toBe(441);
    expect(posts[0]!.postedAt.toISOString()).toMatch(/^20\d\d-/);
    expect(posts.every((p) => !p.links.some((l) => l.includes("t.me/")))).toBe(true);
  });

  it("normaliza el nombre del canal", () => {
    expect(channelHandle("@OfertasChile")).toBe("ofertaschile");
    expect(channelHandle("https://t.me/s/ofertas_cl")).toBe("ofertas_cl");
    expect(channelHandle("t.me/ofertas_cl/")).toBe("ofertas_cl");
    expect(channelHandle("https://evil.com/ofertas")).toBeNull();
    expect(channelHandle("ab")).toBeNull();
  });

  it("html a texto", () => {
    expect(htmlToText("🔥 <b>PS5</b> a $199.990<br/>¡Corre! &amp; vuela")).toBe("🔥 PS5 a $199.990\n¡Corre! & vuela");
  });
});

const POST = `🚨 ERROR DE PRECIO 🚨
Audífonos Sony WH-1000XM5 a $199.990 (antes $399.990) -50% dcto
Usa el cupón SONY10. Envío gratis
https://www.paris.cl/audifonos-sony-wh-1000xm5-600111999.html`;

describe("análisis de un mensaje de ofertas", () => {
  it("precios, % y señales", () => {
    const a = analyzeDealText(POST);
    expect(a.prices).toEqual([199990, 399990]);
    expect(a.discountPct).toBe(50);
    expect(a.flags).toEqual(expect.arrayContaining(["error_precio", "cupon", "envio_gratis", "descuento"]));
  });

  it("links de tiendas soportadas", () => {
    expect(storeLinks(["https://www.paris.cl/audifonos-sony-wh-1000xm5-600111999.html?utm=tg", "https://google.com"])).toEqual([
      { url: "https://paris.cl/audifonos-sony-wh-1000xm5-600111999.html", storeId: "paris", storeName: "Paris" },
    ]);
  });
});

describe("coincidencias", () => {
  const interests = [
    { productId: "p1", name: "Audífonos Sony WH-1000XM5", listingUrls: ["https://simple.ripley.cl/x-2000391128909p"] },
    { productId: "p2", name: "Audífonos", listingUrls: [] },
  ];
  const flags = analyzeDealText(POST).flags;

  it("menciona un producto que sigo (modelo)", () => {
    const m = matchDeal({ text: POST, storeUrls: [], flags: [] }, interests, [], { priceErrors: false })!;
    expect(m.productIds).toEqual(["p1"]);
  });

  it("link exacto a lo que sigo", () => {
    const m = matchDeal({ text: "mira", storeUrls: ["https://simple.ripley.cl/x-2000391128909p"], flags: [] }, interests, [])!;
    expect(m.reasons[0]).toContain("Link a");
  });

  it("palabras clave y errores de precio", () => {
    expect(matchDeal({ text: "Airfryer Philips 4L a $39.990", storeUrls: [], flags: [] }, [], ["airfryer philips"])!.reasons).toEqual([
      'Contiene "airfryer philips"',
    ]);
    expect(matchDeal({ text: "x", storeUrls: [], flags }, [], [])!.reasons).toEqual(["Posible error de precio"]);
    expect(matchDeal({ text: "x", storeUrls: [], flags }, [], [], { priceErrors: false })).toBeNull();
  });

  it("no avisa por nombres genéricos", () => {
    expect(matchDeal({ text: "Audífonos JBL baratos", storeUrls: [], flags: [] }, interests, [], { priceErrors: false })).toBeNull();
  });
});
