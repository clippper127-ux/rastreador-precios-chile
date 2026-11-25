import { describe, expect, it } from "vitest";
import { evaluateAlerts, formatAlertText, type AlertInput, type WatchRules } from "./alerts";

const rules = (r: Partial<WatchRules> = {}): WatchRules => ({
  targetPrice: null,
  dropPct: null,
  notifyAllTimeLow: true,
  notifyRestock: true,
  priceBasis: "no_card",
  excludeThirdParty: false,
  targetArmed: true,
  ...r,
});
const st = (priceOffer: number, stockStatus: AlertInput["next"]["stockStatus"] = "in_stock", priceCard?: number) => ({
  priceNormal: 200000,
  priceOffer,
  priceCard,
  stockStatus,
});
const kinds = (i: AlertInput) => evaluateAlerts(i).events.map((e) => e.kind);

describe("alertas", () => {
  it("precio objetivo: avisa una vez y se rearma al subir", () => {
    const base = { previousMin: 100000, previousSnapshots: 3 };
    const r1 = evaluateAlerts({ ...base, rules: rules({ targetPrice: 150000 }), prev: st(160000), next: st(149990) });
    expect(r1.events.map((e) => e.kind)).toContain("target");
    expect(r1.targetArmed).toBe(false);

    // Sigue bajo el objetivo: no repite.
    const r2 = evaluateAlerts({ ...base, rules: rules({ targetPrice: 150000, targetArmed: false }), prev: st(149990), next: st(145000) });
    expect(r2.events.map((e) => e.kind)).not.toContain("target");

    // Sube sobre el objetivo: se rearma (sin aviso).
    const r3 = evaluateAlerts({ ...base, rules: rules({ targetPrice: 150000, targetArmed: false }), prev: st(145000), next: st(155000) });
    expect(r3.targetArmed).toBe(true);
    expect(r3.events).toHaveLength(0);
  });

  it("baja de X%", () => {
    const i = { rules: rules({ dropPct: 10, notifyAllTimeLow: false }), previousMin: 50000, previousSnapshots: 2 };
    expect(kinds({ ...i, prev: st(100000), next: st(89000) })).toEqual(["drop_pct"]);
    expect(kinds({ ...i, prev: st(100000), next: st(95000) })).toEqual([]);
  });

  it("mínimo histórico solo con historial previo y estrictamente menor", () => {
    expect(kinds({ rules: rules(), prev: null, next: st(90000), previousMin: null, previousSnapshots: 0 })).toEqual([]);
    expect(kinds({ rules: rules(), prev: st(95000), next: st(90000), previousMin: 90000, previousSnapshots: 4 })).toEqual([]);
    expect(kinds({ rules: rules(), prev: st(95000), next: st(89990), previousMin: 90000, previousSnapshots: 4 })).toEqual([
      "all_time_low",
    ]);
  });

  it("vuelve el stock (no desde 'desconocido')", () => {
    const i = { rules: rules({ notifyAllTimeLow: false }), previousMin: 1, previousSnapshots: 1 };
    expect(kinds({ ...i, prev: st(100000, "out_of_stock"), next: st(100000) })).toEqual(["restock"]);
    expect(kinds({ ...i, prev: st(100000, "unknown"), next: st(100000) })).toEqual([]);
  });

  it("sin stock no avisa bajas", () => {
    expect(kinds({ rules: rules({ targetPrice: 999999 }), prev: st(100000), next: st(50000, "out_of_stock"), previousMin: 90000, previousSnapshots: 3 })).toEqual([]);
  });

  it("con tarjeta usa el precio con tarjeta", () => {
    const r = evaluateAlerts({
      rules: rules({ targetPrice: 100000, priceBasis: "with_card", notifyAllTimeLow: false }),
      prev: st(120000, "in_stock", 110000),
      next: st(120000, "in_stock", 99990),
      previousMin: 110000,
      previousSnapshots: 2,
    });
    expect(r.events[0]).toMatchObject({ kind: "target", price: 99990 });
  });

  it("excluye vendedores terceros si se pidió", () => {
    expect(
      kinds({ rules: rules({ excludeThirdParty: true, targetPrice: 999999 }), prev: st(1), next: st(1000), previousMin: 5000, previousSnapshots: 1, sellerType: "third_party" }),
    ).toEqual([]);
  });

  it("mensaje legible", () => {
    const m = formatAlertText({
      productName: "PS5 Slim",
      storeName: "Paris",
      reasons: ["Bajó de tu precio objetivo ($450.000)", "Mínimo histórico (antes $470.000)"],
      priceNoCard: 449990,
      priceCard: 429990,
      cardName: "Tarjeta Cencosud",
      productUrl: "http://localhost:3000/producto/1",
      storeUrl: "https://www.paris.cl/ps5-1.html",
    });
    expect(m.subject.replace(/\s/g, " ")).toContain("PS5 Slim a $449.990");
    expect(m.text).toContain("con Tarjeta Cencosud");
    expect(m.text).toContain("• Mínimo histórico");
  });
});
