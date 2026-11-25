/**
 * Recorta una página para guardarla como fixture de test. Conserva, tal cual vienen de la tienda:
 * - los <script> JSON-LD y __NEXT_DATA__,
 * - los bloques de precio (`class="prices...`) con su HTML original.
 * Una ficha de 2 MB queda en pocos KB y el test sigue usando el marcado real.
 */
export function trimHtmlForFixture(html: string): string {
  const scripts = [
    ...html.matchAll(/<script[^>]*(?:ld\+json|__NEXT_DATA__)[^>]*>[\s\S]*?<\/script>/gi),
  ].map((m) => m[0]);

  const blocks: string[] = [];
  const re = /<div class="prices[\s"]/g;
  for (const m of html.matchAll(re)) {
    if (blocks.length >= 12) break;
    blocks.push(html.slice(m.index!, m.index! + 6_000));
  }
  // Fichas sin bloque .prices (p. ej. Jumbo): el <h1> y lo que sigue (precio, tachado, precio unitario).
  if (!blocks.length) {
    const h1 = html.search(/<h1[\s>]/);
    if (h1 >= 0) blocks.push(html.slice(h1, h1 + 8_000).replace(/<svg[\s\S]*?<\/svg>/g, ""));
  }

  const compact = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");

  return [
    "<!-- Fixture recortado por apps/worker/src/fixtures.ts: JSON-LD + bloques de precio originales -->",
    "<html><head>",
    ...scripts,
    "</head><body>",
    ...blocks.map((b) => `<section data-fixture-block>\n${compact(b)}\n</section>`),
    "</body></html>",
  ].join("\n");
}
