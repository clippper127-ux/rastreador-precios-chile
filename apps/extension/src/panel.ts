import { formatCLP, type CapturedProduct, type ExtensionStore } from "@rastreador/core";
import type { IngestResponse } from "./shared";

/*
 * Panel flotante en la ficha de producto. Shadow DOM para no heredar ni romper estilos de la tienda.
 * Estados: leyendo → (sin configurar | no seguido + "Seguir precio" | seguido + historial) | error.
 */

export interface PanelProps {
  store: ExtensionStore;
  capture: CapturedProduct | null;
  state: IngestResponse;
  busy?: boolean;
  onFollow: () => void;
  /** Cuántas selecciones manuales de precio hay para esta tienda. */
  picks?: number;
  onPick?: () => void;
  onClearPicks?: () => void;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  --bg: #ffffff; --fg: #1e2230; --muted: #646b7d; --border: #e3e6ee; --brand: #4f46e5; --deal: #0f8a5f;
  --card: #8a3fd1; --caution: #9a6300; --danger: #c2362b; --soft: #f3f4f8;
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: 300px; max-width: calc(100vw - 32px);
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg);
  background: var(--bg); border: 1px solid var(--border); border-radius: 16px;
  box-shadow: 0 2px 4px rgba(20,22,30,.06), 0 16px 40px -12px rgba(20,22,30,.25);
}
@media (prefers-color-scheme: dark) {
  .wrap { --bg: #1b1e27; --fg: #eef0f5; --muted: #a3a9b8; --border: #2e3240; --brand: #8b85ff; --deal: #4fd1a1;
    --card: #c79bf5; --caution: #f0c060; --danger: #ff8a80; --soft: #252935; }
}
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.logo { width: 22px; height: 22px; border-radius: 7px; background: var(--fg); display: grid; place-items: center; flex: none; }
.logo svg { width: 14px; height: 14px; }
.title { font-weight: 600; flex: 1; min-width: 0; }
.title small { display: block; font-weight: 400; color: var(--muted); font-size: 11px; }
button { font: inherit; cursor: pointer; border: 0; }
.icon { background: transparent; color: var(--muted); width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; }
.icon:hover { background: var(--soft); color: var(--fg); }
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.price { font-size: 22px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.strike { color: var(--muted); text-decoration: line-through; font-variant-numeric: tabular-nums; }
.cardp { color: var(--card); font-weight: 600; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); font-size: 12px; }
.badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
.ok { background: color-mix(in srgb, var(--deal) 14%, transparent); color: var(--deal); }
.warn { background: color-mix(in srgb, var(--caution) 16%, transparent); color: var(--caution); }
.err { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
.primary { background: var(--fg); color: var(--bg); border-radius: 999px; height: 36px; padding: 0 16px; font-weight: 600; width: 100%; }
.primary:disabled { opacity: .6; cursor: default; }
a { color: var(--brand); text-decoration: none; font-weight: 600; }
a:hover { text-decoration: underline; }
svg.spark { width: 100%; height: 36px; display: block; }
.tools { display: flex; flex-wrap: wrap; gap: 4px 12px; border-top: 1px solid var(--border); padding-top: 8px; }
.link { background: none; color: var(--brand); font-weight: 600; font-size: 12px; padding: 2px 0; }
.link:hover { text-decoration: underline; }
.choices { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.choice { background: var(--soft); color: var(--fg); border-radius: 10px; padding: 8px 4px; font-weight: 600; font-size: 12px; }
.choice:hover { outline: 2px solid var(--brand); }
.pill { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; }
.pill button { display: flex; align-items: center; gap: 8px; background: var(--bg); color: var(--fg); border: 1px solid var(--border);
  border-radius: 999px; padding: 8px 12px 8px 8px; font-weight: 600; box-shadow: 0 8px 24px -8px rgba(20,22,30,.3); }
`;

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 21l5-5 4 3.5 8-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="color:var(--bg)"/></svg>`;

const ERRORS: Record<string, string> = {
  sin_configurar: "Conecta la extensión: abre su ícono y pega tu token (Ajustes en la app).",
  token_invalido: "El token no es válido. Genera uno nuevo en Ajustes de la app.",
  sin_conexion: "No pudimos conectar con la app. ¿Está abierta?",
  no_leido: "No pudimos leer el precio en esta página. Puedes ingresarlo a mano en la app.",
  demasiadas_solicitudes: "Demasiadas actualizaciones seguidas. Intenta en un minuto.",
  extension_recargada: "La extensión se actualizó. Recarga la página.",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function spark(points: { t: number; price: number }[]): string {
  if (points.length < 2) return "";
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.price);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 276, H = 36, pad = 3;
  const x = (t: number) => (x1 === x0 ? 0 : ((t - x0) / (x1 - x0)) * W);
  const y = (v: number) => (y1 === y0 ? H / 2 : pad + (1 - (v - y0) / (y1 - y0)) * (H - pad * 2));
  // Escalón: el precio se mantiene hasta el siguiente cambio.
  let d = `M${x(points[0]!.t)},${y(points[0]!.price)}`;
  for (let i = 1; i < points.length; i++) d += ` H${x(points[i]!.t)} V${y(points[i]!.price)}`;
  const trend = ys[ys.length - 1]! < ys[0]! ? "var(--deal)" : ys[ys.length - 1]! > ys[0]! ? "var(--danger)" : "var(--muted)";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${trend}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

let host: HTMLElement | null = null;
let collapsed = false;
let lastProps: PanelProps | null = null;

void chrome.storage.local.get("collapsed").then((s) => {
  collapsed = !!s.collapsed;
  if (lastProps) renderPanel(lastProps);
});

function setCollapsed(v: boolean) {
  collapsed = v;
  void chrome.storage.local.set({ collapsed: v });
  if (lastProps) renderPanel(lastProps);
}

export function renderPanel(props: PanelProps | null) {
  lastProps = props;
  if (!props) {
    host?.remove();
    host = null;
    return;
  }
  if (!host) {
    host = document.createElement("rastreador-precios-panel");
    host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot!;
  const { store, capture: c, state, busy } = props;

  if (collapsed) {
    root.innerHTML = `<style>${CSS}</style><div class="wrap pill" style="width:auto;border:0;background:none;box-shadow:none">
      <button type="button" data-act="expand" aria-label="Mostrar panel de Rastreador">
        <span class="logo">${LOGO}</span>${c ? esc(formatCLP(c.priceOffer ?? c.priceNormal)) : "Rastreador"}
        ${state.tracked ? '<span class="badge ok">Siguiendo</span>' : ""}
      </button></div>`;
    root.querySelector('[data-act="expand"]')!.addEventListener("click", () => setCollapsed(false));
    return;
  }

  const noCard = c ? (c.priceOffer ?? c.priceNormal) : undefined;
  let status = "";
  if (busy) status = `<p class="muted">Conectando…</p>`;
  else if (state.error) status = `<p><span class="badge ${state.error === "sin_configurar" ? "warn" : "err"}">${state.error === "sin_configurar" ? "Sin conectar" : "Error"}</span></p><p class="muted">${esc(ERRORS[state.error] ?? `No se pudo guardar (${state.error}).`)}</p>`;
  else if (state.tracked) {
    const min = state.minPrice90d != null ? `Mínimo 90 días: <strong>${esc(formatCLP(state.minPrice90d))}</strong>` : "";
    const atMin = state.minPrice90d != null && noCard != null && noCard <= state.minPrice90d;
    status = `<p class="row"><span class="badge ok">✓ Siguiendo</span><span class="muted">${state.changed ? "Precio nuevo guardado" : "Precio sin cambios"}</span></p>
      ${spark(state.points ?? [])}
      <p class="muted">${min}${atMin ? ' · <span class="badge ok">En su mínimo</span>' : ""}</p>
      ${state.productId && state.appUrl ? `<a href="${esc(state.appUrl)}/producto/${esc(state.productId)}" target="_blank" rel="noopener">Ver historial completo →</a>` : ""}`;
  } else {
    status = `<button type="button" class="primary" data-act="follow">Seguir precio</button>
      <p class="muted">Guardaremos el precio cada vez que abras esta ficha.</p>`;
  }

  root.innerHTML = `<style>${CSS}</style>
  <section class="wrap" role="region" aria-label="Rastreador de precios">
    <header>
      <span class="logo">${LOGO}</span>
      <span class="title">Rastreador<small>${esc(store.name)}</small></span>
      <button type="button" class="icon" data-act="collapse" aria-label="Minimizar panel">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </header>
    <div class="body">
      ${
        c
          ? `<div>
          <div class="row"><span class="price">${esc(formatCLP(noCard))}</span>${c.priceOffer != null && c.priceNormal != null ? `<span class="strike">${esc(formatCLP(c.priceNormal))}</span>` : ""}</div>
          ${c.priceCard != null ? `<div class="cardp">${esc(formatCLP(c.priceCard))} <span class="muted">con ${esc(c.cardName ?? "tarjeta")}</span></div>` : ""}
          ${c.sellerType === "third_party" ? `<p class="muted">Vendido por un tercero${c.seller ? `: ${esc(c.seller)}` : ""}</p>` : ""}
          ${c.stockStatus === "out_of_stock" ? `<span class="badge err">Sin stock</span>` : ""}
        </div>`
          : ""
      }
      ${status}
      ${
        props.onPick && !busy
          ? `<div class="tools">
        <button type="button" class="link" data-act="pick">${props.picks ? "Volver a elegir el precio" : "¿Precio mal leído? Elígelo en la página"}</button>
        ${props.picks ? `<button type="button" class="link" data-act="clear">Olvidar mi selección</button>` : ""}
      </div>`
          : ""
      }
    </div>
  </section>`;

  root.querySelector('[data-act="collapse"]')?.addEventListener("click", () => setCollapsed(true));
  root.querySelector('[data-act="pick"]')?.addEventListener("click", () => props.onPick?.());
  root.querySelector('[data-act="clear"]')?.addEventListener("click", () => props.onClearPicks?.());
  const follow = root.querySelector<HTMLButtonElement>('[data-act="follow"]');
  if (follow) {
    follow.addEventListener("click", () => {
      follow.disabled = true;
      follow.textContent = "Siguiendo…";
      props.onFollow();
    });
  }
}

export interface SearchPanelProps {
  store: ExtensionStore;
  count: number;
  state: IngestResponse;
  busy?: boolean;
  onSend: () => void;
}

/** Panel en páginas de resultados: envía lo que estás viendo a la búsqueda unificada de la app. */
export function renderSearchPanel(props: SearchPanelProps) {
  lastProps = null;
  if (!host) {
    host = document.createElement("rastreador-precios-panel");
    host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot!;
  const { store, count, state, busy } = props;
  let body: string;
  if (busy) body = `<p class="muted">Enviando…</p>`;
  else if (state.error)
    body = `<p><span class="badge err">Error</span></p><p class="muted">${esc(ERRORS[state.error] ?? `No se pudo enviar (${state.error}).`)}</p>`;
  else if (state.count != null)
    body = `<p class="row"><span class="badge ok">✓ Enviado</span><span class="muted">${state.count} productos</span></p>
      ${state.appUrl && state.query ? `<a href="${esc(state.appUrl)}/buscar?q=${encodeURIComponent(state.query)}" target="_blank" rel="noopener">Ver comparación en Rastreador →</a>` : ""}`;
  else
    body = `<button type="button" class="primary" data-act="send">Enviar ${count} resultados a Rastreador</button>
      <p class="muted">Para compararlos con otras tiendas. Solo se envía esta lista.</p>`;

  root.innerHTML = `<style>${CSS}</style>
  <section class="wrap" role="region" aria-label="Rastreador de precios">
    <header>
      <span class="logo">${LOGO}</span>
      <span class="title">Rastreador<small>${esc(store.name)} · ${count} productos en pantalla</small></span>
      <button type="button" class="icon" data-act="close" aria-label="Cerrar panel">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </header>
    <div class="body">${body}</div>
  </section>`;
  root.querySelector('[data-act="close"]')?.addEventListener("click", () => {
    host?.remove();
    host = null;
  });
  const send = root.querySelector<HTMLButtonElement>('[data-act="send"]');
  send?.addEventListener("click", () => {
    send.disabled = true;
    props.onSend();
  });
}

/** Elemento del panel (para que el modo selección no lo tome como precio). */
export function panelHost(): Element | null {
  return host;
}

type PickChoice = "priceNormal" | "priceOffer" | "priceCard" | null;

/** Después de hacer clic en un precio: ¿qué tipo de precio es? */
export function renderPickChoice(props: { store: ExtensionStore; price?: number; onChoose: (field: PickChoice) => void }) {
  lastProps = null;
  if (!host) {
    host = document.createElement("rastreador-precios-panel");
    host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot!;
  const body =
    props.price == null
      ? `<p class="muted">Eso no parece un precio. Haz clic justo sobre el número (por ejemplo "$19.990").</p>
         <button type="button" class="primary" data-f="retry">Intentar de nuevo</button>`
      : `<p>Leímos <span class="price">${esc(formatCLP(props.price))}</span></p>
         <p class="muted">¿Qué precio es? Lo recordaremos para todas las fichas de ${esc(props.store.name)} en este navegador.</p>
         <div class="choices">
           <button type="button" class="choice" data-f="priceNormal">Normal</button>
           <button type="button" class="choice" data-f="priceOffer">Oferta</button>
           <button type="button" class="choice" data-f="priceCard">Con tarjeta</button>
         </div>`;
  root.innerHTML = `<style>${CSS}</style>
  <section class="wrap" role="region" aria-label="Rastreador de precios">
    <header>
      <span class="logo">${LOGO}</span>
      <span class="title">Elegir precio<small>${esc(props.store.name)}</small></span>
      <button type="button" class="icon" data-f="cancel" aria-label="Cancelar">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </header>
    <div class="body">${body}</div>
  </section>`;
  for (const b of root.querySelectorAll<HTMLButtonElement>("[data-f]")) {
    b.addEventListener("click", () => {
      const f = b.dataset.f!;
      props.onChoose(f === "cancel" || f === "retry" ? null : (f as PickChoice));
    });
  }
}
