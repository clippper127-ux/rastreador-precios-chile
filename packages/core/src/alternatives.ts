import { foldText, isMeasureToken, measureLabel, normalizeMeasures, parseQuery, relevance, type ResultGroup } from "./search";

/*
 * Alternativas equivalentes: modelos parecidos más baratos (mismo tipo de producto y misma medida,
 * otra marca o modelo). Siempre como sugerencia: nunca reemplazan lo que sigues.
 */

/** Palabras que no describen el tipo de producto. */
const NOISE = new Set(
  "de del la el los las con para y en por sin nuevo nueva original oficial pack set kit color negro negra blanco blanca gris azul rojo roja rosado verde plateado dorado"
    .split(" "),
);

/**
 * Consulta genérica desde el nombre: tipo de producto (primeras palabras sin marca ni modelo) + medidas.
 * "Audífonos Sony WH-1000XM5 Bluetooth" → "audifonos bluetooth"; 'Smart TV Samsung 55" Crystal UHD 4K' → 'smart tv 4k 55"'.
 */
export function alternativeQuery(name: string, brand?: string | null): string | undefined {
  const brandWords = new Set(brand ? foldText(brand).split(/[^a-z0-9]+/).filter(Boolean) : []);
  const folded = normalizeMeasures(foldText(name));
  const words = folded.split(/[^a-z0-9_]+/).filter(Boolean);
  const kind: string[] = [];
  const measures: string[] = [];
  for (const w of words) {
    if (isMeasureToken(w) && !/^[345]g$/.test(w)) {
      if (!measures.includes(w)) measures.push(w);
      continue;
    }
    if (w === "4k" || w === "8k") {
      kind.push(w);
      continue;
    }
    // Fuera: marca, códigos de modelo (con números), palabras cortas y de relleno.
    if (brandWords.has(w) || /\d/.test(w) || (w.length < 3 && w !== "tv") || NOISE.has(w)) continue;
    // Dos palabras bastan para el tipo ("smart tv", "audifonos bluetooth"); más suelen ser la línea de la marca.
    if (kind.filter((k) => !/^[48]k$/.test(k)).length < 2 && !kind.includes(w)) kind.push(w);
  }
  if (!kind.length) return undefined;
  // Medidas escritas como las escribe la gente ("55\"", "3 L"): la consulta también va a SoloTodo.
  return [...kind, ...measures.map(measureLabel)].join(" ");
}

/**
 * Elige alternativas entre los grupos de una búsqueda genérica: descarta el mismo producto (mismo link o
 * nombre casi igual) y deja solo las más baratas que el mejor precio actual, de menor a mayor precio.
 * `maybeSame`: nombre muy parecido (≥ 50 %): quizás es el mismo producto en otra tienda.
 */
export function pickAlternatives(
  groups: ResultGroup[],
  current: { name: string; urls: string[]; bestNoCard?: number },
  max = 4,
): (ResultGroup & { maybeSame: boolean })[] {
  if (!current.bestNoCard) return [];
  const urls = new Set(current.urls);
  const self = parseQuery(current.name);
  return groups
    .filter((g) => g.bestNoCard != null && g.bestNoCard < current.bestNoCard! * 0.97)
    .filter((g) => !g.items.some((i) => urls.has(i.url)) && relevance(self, g.title) < 0.8)
    .sort((a, b) => a.bestNoCard! - b.bestNoCard!)
    .slice(0, max)
    .map((g) => ({ ...g, maybeSame: relevance(self, g.title) >= 0.5 }));
}
