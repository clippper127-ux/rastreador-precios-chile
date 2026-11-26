import { describe, expect, it } from "vitest";
import { formatUnitPrice, unitPriceFromTitle } from "./unit-price";

describe("unitPriceFromTitle", () => {
  it("litros y kilos", () => {
    expect(unitPriceFromTitle("Detergente líquido 3 L", 8990)).toEqual({ value: 2997, unit: "L", qty: 3000 });
    expect(unitPriceFromTitle("Arroz grado 1 1 kg", 1590)).toMatchObject({ value: 1590, unit: "kg" });
    expect(unitPriceFromTitle("Café molido 250 g", 4990)).toMatchObject({ value: 19960, unit: "kg" });
  });
  it("packs multiplican", () => {
    expect(unitPriceFromTitle("Cerveza pack 6 x 350 ml", 5990)).toMatchObject({ unit: "L", qty: 2100, value: 2852 });
  });
  it("solo unidades", () => {
    expect(unitPriceFromTitle("Pañales talla G 50 un", 12990)).toEqual({ value: 260, unit: "un", qty: 50 });
    expect(formatUnitPrice({ value: 260, unit: "un", qty: 50 })).toBe("$260 c/u");
  });
  it("sin medida o ambigua", () => {
    expect(unitPriceFromTitle("Notebook Lenovo IdeaPad 512 GB", 399990)).toBeUndefined();
    expect(unitPriceFromTitle("Consola PS5", 499990)).toBeUndefined();
    expect(unitPriceFromTitle("Celular 5G 128 GB", 199990)).toBeUndefined();
  });
  it("formato", () => {
    expect(formatUnitPrice({ value: 2997, unit: "L", qty: 3000 })).toBe("$2.997/L");
  });
});
