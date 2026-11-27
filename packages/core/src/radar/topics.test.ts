import { describe, expect, it } from "vitest";
import { anonymize, chatTopics } from "./topics";

const at = (m: number) => new Date(Date.UTC(2026, 10, 27, 12, m));

describe("chatTopics", () => {
  it("detecta un tema que se calienta (tarjeta Mach) y no la charla suelta", () => {
    const texts = [
      "alguien sabe cuánto cobra de mantención la tarjeta Mach crédito?",
      "con la Mach tienes 40% en Mercado Libre",
      "la Mach crédito no cobra mantención creo",
      "yo usé la Mach y me salió el 40% con tope 20 mil",
      "la Mach te pide pagar en el carro",
      "a mí la Mach no me dejó",
      "buenas noches",
      "qué calor hace",
    ];
    const topics = chatTopics(texts.map((text, i) => ({ id: i + 1, text, postedAt: at(i * 5) })));
    expect(topics[0]?.word).toBe("mach");
    expect(topics[0]?.postIds).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("menos de 6 mensajes o muy repartidos en el tiempo no es tema", () => {
    const texts = Array.from({ length: 6 }, () => "la tarjeta Mach");
    expect(chatTopics(texts.slice(0, 4).map((text, i) => ({ id: i, text, postedAt: at(i) })))).toEqual([]);
    expect(chatTopics(texts.map((text, i) => ({ id: i, text, postedAt: at(i * 40) })))).toEqual([]);
  });
});

describe("anonymize", () => {
  it("quita usuarios, correos y teléfonos", () => {
    expect(anonymize("háblale a @tiobunny o escribe a ana@mail.com o al +56 9 1234 5678")).toBe(
      "háblale a @usuario o escribe a [correo] o al [teléfono]",
    );
  });
});
