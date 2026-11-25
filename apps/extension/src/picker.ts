import { toCLP, type CapturedProduct, type ExtensionStore } from "@rastreador/core";

/*
 * "Elegir el precio en la página" (como Distill): haces clic sobre el precio y la extensión recuerda
 * dónde está en esa tienda. Se guarda solo en este navegador (chrome.storage.local), por tienda.
 */

export type PickField = "priceNormal" | "priceOffer" | "priceCard";
export interface PickRule {
  selector: string;
  field: PickField;
}

const KEY = "picks";

export async function getPicks(storeId: string): Promise<PickRule[]> {
  const s = (await chrome.storage.local.get(KEY)) as { picks?: Record<string, PickRule[]> };
  return s.picks?.[storeId] ?? [];
}

export async function savePick(storeId: string, rule: PickRule): Promise<void> {
  const s = (await chrome.storage.local.get(KEY)) as { picks?: Record<string, PickRule[]> };
  const all = s.picks ?? {};
  // Un selector por tipo de precio: el nuevo reemplaza al anterior.
  all[storeId] = [...(all[storeId] ?? []).filter((r) => r.field !== rule.field), rule];
  await chrome.storage.local.set({ [KEY]: all });
}

export async function clearPicks(storeId: string): Promise<void> {
  const s = (await chrome.storage.local.get(KEY)) as { picks?: Record<string, PickRule[]> };
  const all = s.picks ?? {};
  delete all[storeId];
  await chrome.storage.local.set({ [KEY]: all });
}

/** Precio que muestra un elemento (solo números razonables en pesos). */
export function priceIn(el: Element | null): number | undefined {
  const text = (el as HTMLElement | null)?.innerText ?? el?.textContent ?? "";
  const m = text.replace(/\s+/g, " ").match(/\$?\s?\d{1,3}(?:\.\d{3})+|\$\s?\d{3,}/);
  const n = toCLP(m?.[0]);
  return n != null && n >= 100 && n < 100_000_000 ? n : undefined;
}

/** Aplica tus selecciones sobre lo que leyó la extensión (o arma la captura si no había leído nada). */
export function applyPicks(capture: CapturedProduct | null, rules: PickRule[], store: ExtensionStore): CapturedProduct | null {
  if (!rules.length) return capture;
  const picked: Partial<Record<PickField, number>> = {};
  for (const r of rules) {
    let el: Element | null = null;
    try {
      el = document.querySelector(r.selector);
    } catch {
      /* selector inválido: se ignora */
    }
    const v = priceIn(el);
    if (v != null) picked[r.field] = v;
  }
  if (!Object.keys(picked).length) return capture;
  const title =
    capture?.title ??
    document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ??
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
  if (!title) return capture;
  const out: CapturedProduct = {
    ...(capture ?? { url: location.href, title, stockStatus: "in_stock" as const }),
    ...picked,
  };
  if (picked.priceCard != null) out.cardName = capture?.cardName ?? store.cardName;
  if (out.priceOffer != null && out.priceNormal != null && out.priceOffer >= out.priceNormal) delete out.priceOffer;
  return out;
}

/** Selector CSS corto y estable para un elemento (evita clases generadas tipo "css-1x2y3z"). */
export function cssPath(el: Element): string {
  const stableClass = (c: string) => /^[a-z][\w-]{1,40}$/i.test(c) && !/\d{3,}|^(css|sc|jsx|emotion)-|__[a-z0-9]{5,}$/i.test(c);
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && node !== document.body && depth < 6; depth++) {
    if (node.id && /^[a-z][\w-]{1,40}$/i.test(node.id) && !/\d{3,}/.test(node.id)) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const classes = [...node.classList].filter(stableClass).slice(0, 2);
    if (classes.length) part += classes.map((c) => `.${CSS.escape(c)}`).join("");
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === node!.tagName && (!classes.length || classes.every((k) => c.classList.contains(k))));
      if (same.length > 1) part += `:nth-of-type(${[...parent.children].filter((c) => c.tagName === node!.tagName).indexOf(node) + 1})`;
    }
    parts.unshift(part);
    const sel = parts.join(" > ");
    try {
      if (document.querySelector(sel) === el) return sel;
    } catch {
      /* sigue subiendo */
    }
    node = parent;
  }
  return parts.join(" > ");
}

/** Modo selección: resalta lo que está bajo el mouse; clic elige, Esc cancela. */
export function startPicker(ignore: Element | null): Promise<Element | null> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed", zIndex: "2147483645", pointerEvents: "none", border: "2px solid #4f46e5",
      background: "rgba(79,70,229,.12)", borderRadius: "6px", transition: "all 60ms",
    });
    const tip = document.createElement("div");
    tip.textContent = "Haz clic sobre el precio · Esc para cancelar";
    Object.assign(tip.style, {
      position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647",
      background: "#1e2230", color: "#fff", font: "600 13px system-ui, sans-serif", padding: "8px 14px", borderRadius: "999px",
      boxShadow: "0 8px 24px -8px rgba(0,0,0,.4)", pointerEvents: "none",
    });
    document.documentElement.append(box, tip);
    let current: Element | null = null;

    const over = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t || (ignore && (t === ignore || ignore.contains(t)))) return;
      current = t;
      const r = t.getBoundingClientRect();
      Object.assign(box.style, { top: `${r.top - 2}px`, left: `${r.left - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    };
    const done = (el: Element | null) => {
      document.removeEventListener("mouseover", over, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      box.remove();
      tip.remove();
      resolve(el);
    };
    const click = (e: MouseEvent) => {
      if (ignore && ignore.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      done(current ?? (e.target as Element));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    };
    document.addEventListener("mouseover", over, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
  });
}
