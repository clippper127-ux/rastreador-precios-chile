import { describe, expect, it } from "vitest";
import { analyzeDealText } from "./index";
import { chatBuzz, dealFingerprint, hotScore, HOT_LEVELS } from "./hot";

const score = (text: string, extra: Partial<Parameters<typeof hotScore>[0]> = {}, words: string[] = []) => {
  const a = analyzeDealText(text);
  return hotScore({ text, prices: a.prices, discountPct: a.discountPct, flags: a.flags, ...extra }, words);
};

describe("hotScore", () => {
  it("mensaje normal no destaca", () => {
    expect(score("Notebook Lenovo a $399.990 en Paris").score).toBeLessThan(HOT_LEVELS[3].minScore);
  });
  it("descuento alto + palabras destaca", () => {
    const r = score("🔥🔥 Bloqueador Eucerin -75% quedan pocos, corran!");
    expect(r.score).toBeGreaterThanOrEqual(HOT_LEVELS[2].minScore);
    expect(r.reasons.join(" ")).toMatch(/75%/);
  });
  it("precio antes y después", () => {
    const r = score("Bloqueador Isdin antes $19.990 ahora $4.990");
    expect(r.reasons.some((x) => x.includes("baja de precio de 75%"))).toBe(true);
  });
  it("reacción del grupo suma aunque el texto sea pobre", () => {
    const r = score("bloqueadores a luca en lider", { reactions: 25, replies: 12 });
    expect(r.score).toBeGreaterThanOrEqual(HOT_LEVELS[2].minScore);
  });
  it("una conversación sin precio, descuento ni link no es oferta aunque tenga respuestas", () => {
    const r = score("me causa gracia que paguen 5 mil por un grupo vip", { replies: 7, reactions: 10, buzz: { count: 6, word: "vip" } });
    expect(r.score).toBe(0);
  });
  it("respuestas en un mensaje con link sí suman", () => {
    const r = score("miren esto", { replies: 10, hasLink: true });
    expect(r.reasons).toContain("10 respuestas");
  });
  it("palabras del usuario (sin tildes)", () => {
    expect(score("Está tiradísimo el café", {}, ["tiradisimo"]).reasons.join()).toMatch(/tiradisimo/);
    expect(score("Está tiradísimo el café").reasons.join()).not.toMatch(/tiradisimo/);
  });
  it("bajo mínimo histórico", () => {
    expect(score("PS5 a $299.990", { historicalMin: 349_990 }).reasons).toContain("bajo su mínimo histórico");
  });
  it("palabra completa, no parte de otra", () => {
    expect(score("corredor de propiedades").reasons.join()).not.toMatch(/corre/);
  });
});

describe("dealFingerprint", () => {
  it("misma oferta en dos grupos → misma huella", () => {
    expect(dealFingerprint("Bloqueador -75%! https://x.cl/a", [])).toBe(dealFingerprint("bloqueador  -75% https://otro.cl", []));
    expect(dealFingerprint("x", ["https://www.lider.cl/p/1"])).toBe("u:https://www.lider.cl/p/1");
  });
});

describe("chatBuzz", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 25, 12, min));
  it("varios mensajes del mismo producto en poco rato", () => {
    const posts = [
      { id: 1, text: "Bloqueadores Eucerin a luca en Preunic!", postedAt: at(0) },
      { id: 2, text: "se lograron los bloqueadores", postedAt: at(5) },
      { id: 3, text: "me quedé sin bloqueador :(", postedAt: at(9) },
      { id: 4, text: "a mí me llegó el bloqueador", postedAt: at(20) },
      { id: 5, text: "compré 3 bloqueadores", postedAt: at(30) },
      { id: 6, text: "alguien sabe del notebook?", postedAt: at(31) },
      ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, text: `mensaje random ${i} sobre otras cosas`, postedAt: at(40 + i) })),
    ];
    const b = chatBuzz(posts).get(1);
    expect(b?.word).toBe("bloqueador");
    expect(b?.count).toBe(4);
    expect(hotScore({ text: posts[0]!.text, prices: [], flags: [], buzz: b }).score).toBeGreaterThanOrEqual(HOT_LEVELS[2].minScore);
  });
});

it("99% es probable error de precio y destaca solo", () => {
  expect(score("Dscto. 99% Camisa $48.990 -> $25 (99%)").score).toBeGreaterThanOrEqual(HOT_LEVELS[2].minScore);
});
