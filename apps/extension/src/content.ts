import {
  extensionStoreForUrl,
  falabellaFromNextData,
  formatCLP,
  genericCapture,
  type CapturedProduct,
  type ExtensionStore,
} from "@rastreador/core";
import { collectCandidates, jsonLdProduct, meta, productContainer } from "./dom";
import { renderPanel, renderSearchPanel } from "./panel";
import { captureSearchResults, isSearchPage, queryFromApp } from "./search-page";
import type { IngestResponse, Msg } from "./shared";

/*
 * Corre solo en fichas de producto de tiendas soportadas. Lee lo que el usuario YA está viendo
 * (sin requests propias a la tienda) y se lo pasa al service worker.
 */

export function capturePage(store: ExtensionStore): CapturedProduct | null {
  const url = location.href;

  // Falabella: __NEXT_DATA__ es exacto, pero solo vale si corresponde a ESTA ficha
  // (en navegación interna de Next.js queda el de la primera página).
  if (store.platform === "falabella") {
    let nd: unknown;
    try {
      nd = JSON.parse(document.getElementById("__NEXT_DATA__")?.textContent ?? "null");
    } catch {
      nd = null;
    }
    const productId = location.pathname.match(/\/(?:product|articulo)\/(\d+)/)?.[1];
    const pdId = (nd as { props?: { pageProps?: { productData?: { id?: string } } } })?.props?.pageProps?.productData?.id;
    if (nd && productId && pdId === productId) {
      const p = falabellaFromNextData(nd, url, store);
      if (p && (p.priceNormal ?? p.priceOffer) != null) return p;
    }
  }

  const h1 = document.querySelector("h1");
  if (!h1) return null;
  const box = productContainer(h1);
  if (!box) return null;
  const text = box.innerText;
  return genericCapture(
    {
      url,
      h1: h1.textContent ?? undefined,
      jsonLdProduct: jsonLdProduct(),
      ogTitle: meta("og:title"),
      ogImage: meta("og:image"),
      candidates: collectCandidates(box),
      outOfStockHint: /agotado|sin stock|no disponible para compra/i.test(text) && !/agregar al carro/i.test(text),
      sellerText: text.match(/vendido por\s*:?\s*\n?\s*([^\n]{2,60})/i)?.[1],
    },
    store,
  );
}

async function send(capture: CapturedProduct, follow: boolean): Promise<IngestResponse> {
  try {
    return (await chrome.runtime.sendMessage({ type: "capture", capture, follow } satisfies Msg)) as IngestResponse;
  } catch {
    return { error: "extension_recargada" };
  }
}

let lastUrl = "";
let running = false;

async function sendSearch(store: ExtensionStore, results: CapturedProduct[]): Promise<IngestResponse> {
  try {
    return (await chrome.runtime.sendMessage({
      type: "searchCapture",
      pageUrl: location.href,
      query: queryFromApp(),
      results,
    } satisfies Msg)) as IngestResponse;
  } catch {
    return { error: "extension_recargada" };
  }
}

async function runSearch(store: ExtensionStore) {
  // Los resultados cargan después del HTML: espera hasta encontrar productos (~8 s).
  let results: CapturedProduct[] = [];
  for (let i = 0; i < 8 && results.length < 3; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    results = captureSearchResults(store);
  }
  if (!results.length) {
    renderPanel(null);
    return;
  }
  const fromApp = !!queryFromApp();
  const render = (state: IngestResponse, busy = false) =>
    renderSearchPanel({
      store,
      count: results.length,
      state,
      busy,
      onSend: async () => {
        render(state, true);
        render(await sendSearch(store, results));
      },
    });
  // Si la búsqueda se abrió desde la app, se envía sola (ya lo pediste allá); si no, espera tu clic.
  if (fromApp) {
    render({}, true);
    render(await sendSearch(store, results));
  } else {
    render({});
  }
}

async function run() {
  const store = extensionStoreForUrl(location.href);
  if (store && isSearchPage(store)) {
    if (!running) {
      running = true;
      try {
        await runSearch(store);
      } finally {
        running = false;
      }
    }
    return;
  }
  if (!store || !store.productPath.test(location.pathname)) {
    renderPanel(null);
    return;
  }
  if (running) return;
  running = true;
  try {
    // Las tiendas cargan precios después del HTML: reintenta hasta ~8 s.
    let capture: CapturedProduct | null = null;
    for (let i = 0; i < 8 && !capture; i++) {
      capture = capturePage(store);
      if (!capture) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!capture) {
      renderPanel({ store, capture: null, state: { error: "no_leido" }, onFollow: () => {} });
      return;
    }
    const cap = capture;
    const render = (state: IngestResponse, busy = false) =>
      renderPanel({
        store,
        capture: cap,
        state,
        busy,
        onFollow: async () => {
          render(state, true);
          render(await send(cap, true));
        },
      });
    render({}, true);
    render(await send(cap, false));
  } finally {
    running = false;
  }
}

// Primera carga + navegación interna (Falabella y Ripley son apps de una sola página).
function tick() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    void run();
  }
}
tick();
setInterval(tick, 1000);

// Para depurar desde la consola de la página: window.__rastreadorCapture()
(globalThis as unknown as Record<string, unknown>).__rastreadorCapture = () => {
  const s = extensionStoreForUrl(location.href);
  const c = s ? capturePage(s) : null;
  console.table(c ? { ...c, priceNormal: formatCLP(c.priceNormal), priceOffer: formatCLP(c.priceOffer), priceCard: formatCLP(c.priceCard) } : {});
  return c;
};
