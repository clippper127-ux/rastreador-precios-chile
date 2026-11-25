import { adapterById, adapters, bestPriceNoCard, bestPriceWithCard, formatCLP } from "@rastreador/core";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { trimHtmlForFixture } from "./fixtures";
import { politeFetch } from "./http";

/**
 * Prueba manual de un adaptador, sin tocar la base de datos:
 *   pnpm check:store hites "https://www.hites.com/....html"
 *   pnpm check:store hites "<url>" --save nombre   → guarda fixture recortado en src/adapters/__fixtures__/
 */
async function main() {
  const args = process.argv.slice(2);
  const saveIdx = args.indexOf("--save");
  const saveName = saveIdx >= 0 ? args[saveIdx + 1] : undefined;
  const [storeId, url] = args.filter((_, i) => saveIdx < 0 || (i !== saveIdx && i !== saveIdx + 1));

  if (!storeId || !url) {
    console.error('Uso: pnpm check:store <tienda> "<url>" [--save nombre]');
    process.exit(1);
  }
  const adapter = adapterById(storeId);
  if (!adapter) {
    console.error(`No hay adaptador "${storeId}". Disponibles: ${adapters.map((a) => a.id).join(", ")}`);
    process.exit(1);
  }

  let rawHtml = "";
  const snapshot = await adapter.getProduct(url, {
    fetch: async (u, init) => {
      const res = await politeFetch(u, { ...init, storeId });
      if (!saveName) return res;
      rawHtml = await res.text();
      return new Response(rawHtml, { status: res.status, headers: res.headers });
    },
  });

  console.dir(snapshot, { depth: null });
  console.log(`\nSin tarjeta: ${formatCLP(bestPriceNoCard(snapshot))} · Con tarjeta: ${formatCLP(bestPriceWithCard(snapshot))}`);

  if (saveName) {
    const dir = fileURLToPath(new URL("../../../packages/core/src/adapters/__fixtures__/", import.meta.url));
    await mkdir(dir, { recursive: true });
    const file = `${dir}${storeId}-${saveName}.html`;
    await writeFile(file, trimHtmlForFixture(rawHtml));
    console.log(`Fixture guardado: ${file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
