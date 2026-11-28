import "server-only";

/*
 * Reconocimiento de producto en una foto con Gemini (opcional; plan gratis de Google AI Studio).
 * Solo se usa si hay LLM_API_KEY. La app funciona completa sin esto: el código de barras se lee
 * en el navegador sin enviar la foto a nadie.
 * Modelo configurable con LLM_MODEL (los nombres y límites gratis cambian: verifícalos en AI Studio).
 */

export function visionEnabled(): boolean {
  return !!process.env.LLM_API_KEY;
}

export interface PhotoGuess {
  /** Texto para buscar: marca + modelo + variante, en español. */
  query: string;
  /** Código de barras si se ve en la foto. */
  ean?: string;
  confidence: "alta" | "media" | "baja";
}

const PROMPT = `Eres un asistente de compras en Chile. Identifica el producto principal de la foto.
Responde SOLO un JSON: {"query": "...", "ean": "...", "confidence": "alta|media|baja"}.
- "query": lo que escribirías en el buscador de una tienda chilena: marca + modelo + variante clave
  (capacidad, tamaño, color si importa). Máximo 8 palabras, en español. Sin precios ni adjetivos.
- "ean": solo si ves el código de barras completo y legible; si no, omítelo.
- Si no hay un producto reconocible, usa "query": "" y "confidence": "baja".`;

export async function identifyProduct(imageBase64: string, mimeType: string): Promise<PhotoGuess | null> {
  const key = process.env.LLM_API_KEY;
  if (!key) return null;
  const model = process.env.LLM_MODEL || "gemini-flash-lite-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 200 },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(res.status === 429 ? "Se alcanzó el límite gratis de Gemini por ahora. Intenta más tarde." : `Gemini respondió ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Partial<PhotoGuess>;
    const query = String(parsed.query ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    const ean = typeof parsed.ean === "string" && /^\d{8,14}$/.test(parsed.ean) ? parsed.ean : undefined;
    const confidence = parsed.confidence === "alta" || parsed.confidence === "media" ? parsed.confidence : "baja";
    return query || ean ? { query, ean, confidence } : null;
  } catch {
    return null;
  }
}
