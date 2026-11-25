import { toCLP, type PriceCandidate } from "@rastreador/core";

/** Lectura del DOM que el usuario está viendo (sin requests propias). */

const PRICE_RE = /^\$\s?\d{1,3}(?:\.\d{3})+$|^\$\s?\d{3,}$/;
const CARD_HINT_RE = /tarjeta|cmr|cencosud|credit|cr[eé]dito|card|ripley|bci/i;

export function isCrossed(el: Element): boolean {
  for (let e: Element | null = el, i = 0; e && i < 3; e = e.parentElement, i++) {
    if (getComputedStyle(e).textDecorationLine.includes("line-through")) return true;
    if (e.tagName === "DEL" || e.tagName === "S") return true;
  }
  return false;
}

export function labelFor(el: Element): string {
  for (let e: Element | null = el.parentElement, i = 0; e && i < 3; e = e.parentElement, i++) {
    const t = (e as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
    if (t.length > 0 && t.length <= 60) return t;
  }
  return "";
}

export function cardHintFor(el: Element): boolean {
  for (let e: Element | null = el, i = 0; e && i < 3; e = e.parentElement, i++) {
    if (CARD_HINT_RE.test(String((e as HTMLElement).className ?? ""))) return true;
    const imgs = e.querySelectorAll("img,svg[aria-label]");
    for (const img of imgs) {
      const hint = `${img.getAttribute("alt") ?? ""} ${img.getAttribute("aria-label") ?? ""} ${img.getAttribute("src") ?? ""}`;
      if (CARD_HINT_RE.test(hint)) return true;
    }
  }
  return false;
}

/** Contenedor del producto: sube desde el h1 hasta encontrar precios, sin llegar a la página completa. */
export function productContainer(h1: Element): HTMLElement | null {
  let box: HTMLElement | null = h1 as HTMLElement;
  for (let i = 0; i < 8 && box; i++) {
    const text = box.innerText ?? "";
    if ((text.match(/\$\s?\d/g)?.length ?? 0) >= 1 && text.length < 6000) return box;
    box = box.parentElement;
  }
  return null;
}

export function collectCandidates(box: HTMLElement): PriceCandidate[] {
  const pick = (maxChildren: number) =>
    [...box.querySelectorAll("*")].filter(
      (e) => e.children.length <= maxChildren && PRICE_RE.test((e.textContent ?? "").trim()) && (e as HTMLElement).offsetParent !== null,
    );
  let els = pick(0);
  if (!els.length) els = pick(2);
  const seen = new Set<string>();
  const out: PriceCandidate[] = [];
  for (const el of els) {
    const value = toCLP((el.textContent ?? "").trim());
    if (value == null) continue;
    const cand = { value, crossed: isCrossed(el), label: labelFor(el), cardHint: cardHintFor(el) };
    const key = `${cand.value}|${cand.crossed}|${cand.cardHint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cand);
  }
  return out;
}

export function jsonLdProduct(): Record<string, unknown> | undefined {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? "");
      const nodes = (Array.isArray(data) ? data : [data]).flatMap((n) => (Array.isArray(n?.["@graph"]) ? n["@graph"] : [n]));
      const p = nodes.find((n) => n?.["@type"] === "Product" || (Array.isArray(n?.["@type"]) && n["@type"].includes("Product")));
      if (p) return p;
    } catch {
      /* JSON-LD inválido: ignorar */
    }
  }
  return undefined;
}

export function meta(prop: string): string | undefined {
  return document.querySelector(`meta[property="${prop}"]`)?.getAttribute("content") ?? undefined;
}

