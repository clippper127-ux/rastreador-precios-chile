import { describe, expect, it } from "vitest";
import { couponLooksDead, detectStore, extractCoupons } from "./coupons";

describe("extractCoupons", () => {
  it("lista de cupones en negrita con beneficio y compra mínima", () => {
    const text = "*🔥 ¡CUPONES PARA HOY MIÉRCOLES! 🔥*\n\n🎟️ *BOLSADOBLE30* : $30.000 off en compras desde $350.000\n🎟️ *NAPADOBLE20* : $20.000 off en compras desde $200.000\n🎟️ *VUELTODOBLE8* : $8.000 off en compras desde $80.000";
    const c = extractCoupons(text);
    expect(c.map((x) => x.code)).toEqual(["BOLSADOBLE30", "NAPADOBLE20", "VUELTODOBLE8"]);
    expect(c[0]).toMatchObject({ benefit: "$30.000 off en compras desde $350.000", minPurchase: 350000 });
  });
  it("cupón: y código", () => {
    expect(extractCoupons("Usa el cupón: VERANO15 y obtén 15% en tecnología").map((x) => x.code)).toEqual(["VERANO15"]);
    expect(extractCoupons("Código de descuento ahorro10 válido hoy").map((x) => x.code)).toEqual(["AHORRO10"]);
  });
  it("no confunde palabras comunes con códigos", () => {
    expect(extractCoupons("Si no compras con error de precio puedes conseguir algún cuponcito")).toEqual([]);
    expect(extractCoupons("🔥 80% OFF | $ 15.990\n🎯 Sparta")).toEqual([]);
    expect(extractCoupons("BLACK FRIDAY: todo con descuento")).toEqual([]);
    expect(extractCoupons("Cupones en https://x.cl/cupones-miercoles-25-de-noviembre\nDISPONIBLES: ya")).toEqual([]);
  });
});

describe("detectStore", () => {
  it("hashtag y 🎯 de los bots de ofertas", () => {
    expect(detectStore("🤖 🐰#Tottus ✨💰 Dscto. 89%")).toBe("Tottus");
    expect(detectStore("TUNSTA | Mesa lateral\n🎯 Ikea\n")).toBe("Ikea");
  });
  it("nombre en el texto o dominio del link", () => {
    expect(detectStore("cupón para la app de Falabella")).toBe("Falabella");
    expect(detectStore("mira esto", ["https://ad.soicos.com/x", "https://www.easy.cl/p/1"])).toBe("Easy");
    expect(detectStore("sin pistas")).toBeUndefined();
    expect(detectStore("15% OFF\nCompra acá: https://meli.la/1mPuiFA")).toBe("Mercado Libre");
    expect(detectStore("usa KARY10", ["https://go.stilo.io/p/X/", "https://www.bamers.cl/products/zuecos"])).toBe("bamers.cl");
  });
});

describe("couponLooksDead", () => {
  it("detecta cuando dicen que ya no funciona", () => {
    expect(couponLooksDead("el cupón KARY10 ya no funciona 😢", "KARY10")).toBe(true);
    expect(couponLooksDead("ADI10 no me lo tomó", "ADI10")).toBe(true);
    expect(couponLooksDead("NAPADOBLE20 agotado", "NAPADOBLE20")).toBe(true);
    expect(couponLooksDead("Usa ADI10 y obtén 10% en Adidas", "ADI10")).toBe(false);
  });
  it("en mensajes largos solo mira la línea del código", () => {
    const long = ["🎟️ *BOLSADOBLE30* : $30.000 off en compras desde $350.000", "x".repeat(200), "el cupón de ayer ya no funciona"].join("\n");
    expect(couponLooksDead(long, "BOLSADOBLE30")).toBe(false);
  });
});
