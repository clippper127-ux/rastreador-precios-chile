import { afterEach, describe, expect, it } from "vitest";
import { summarizeWithLlm } from "./summaries";

const reply = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const gemini = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe("summarizeWithLlm", () => {
  const prev = process.env.LLM_API_KEY;
  afterEach(() => {
    process.env.LLM_API_KEY = prev;
  });

  it("sin clave no llama a nadie", async () => {
    process.env.LLM_API_KEY = "";
    expect(await summarizeWithLlm("mach", ["hola"], reply({}))).toBeNull();
  });

  it("lee el JSON de Gemini y recorta lo que sobra", async () => {
    process.env.LLM_API_KEY = "prueba";
    const r = await summarizeWithLlm(
      "mach",
      ["la Mach da 40% en ML"],
      reply(gemini('```json\n{"useful": true, "title": "Tarjeta Mach en Mercado Libre", "bullets": ["40% con tope $20.000", "", "x", "y"]}\n```')),
    );
    expect(r).toEqual({ useful: true, title: "Tarjeta Mach en Mercado Libre", bullets: ["40% con tope $20.000", "x", "y"] });
  });

  it("charla sin datos queda como no útil; respuesta rota → null", async () => {
    process.env.LLM_API_KEY = "prueba";
    expect((await summarizeWithLlm("x", ["jaja"], reply(gemini('{"useful": false, "title": "Charla", "bullets": []}'))))?.useful).toBe(false);
    expect(await summarizeWithLlm("x", ["jaja"], reply(gemini("no es json")))).toBeNull();
  });

  it("no manda @usuarios ni teléfonos a la IA", async () => {
    process.env.LLM_API_KEY = "prueba";
    let sent = "";
    const spy = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify(gemini('{"useful": false, "title": "x", "bullets": []}')));
    }) as unknown as typeof fetch;
    await summarizeWithLlm("mach", ["pregúntale a @juanito o al +56 9 1234 5678"], spy);
    expect(sent).not.toContain("juanito");
    expect(sent).not.toContain("1234");
  });
});
