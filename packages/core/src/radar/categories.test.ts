import { describe, expect, it } from "vitest";
import { blockedByFilters, dealCategories } from "./categories";

describe("dealCategories", () => {
  it("reconoce ropa interior sin tildes", () => {
    expect(dealCategories("ETAM Sostén N°8 Triángulo Idole Mujer 67% OFF")).toContain("ropa_interior");
    expect(dealCategories("Pack 3 Bóxer algodón")).toContain("ropa_interior");
  });
  it("varias categorías y palabra completa", () => {
    expect(dealCategories("Bloqueador Eucerin 50 FPS")).toEqual(["belleza"]);
    expect(dealCategories("Notebook Lenovo + mouse")).toEqual(["tecnologia"]);
    expect(dealCategories("Botella térmica")).toEqual([]); // "bota" no es "botella"
  });
});

describe("blockedByFilters", () => {
  const none = { include: [], exclude: [], blockWords: [] };
  it("nunca: categoría y palabra", () => {
    expect(blockedByFilters("Sostén push up", { ...none, exclude: ["ropa_interior"] })).toEqual({ blocked: true, why: "Ropa interior" });
    expect(blockedByFilters("Crocs clásicas", { ...none, blockWords: ["crocs"] }).blocked).toBe(true);
  });
  it("solo estas: lo de otras categorías o sin categoría se filtra", () => {
    const f = { ...none, include: ["tecnologia"] };
    expect(blockedByFilters("Audífonos Sony", f).blocked).toBe(false);
    expect(blockedByFilters("Bloqueador Isdin", f).blocked).toBe(true);
    expect(blockedByFilters("algo raro", f).blocked).toBe(true);
  });
  it("sin filtros no bloquea", () => {
    expect(blockedByFilters("Sostén", none).blocked).toBe(false);
  });
});
