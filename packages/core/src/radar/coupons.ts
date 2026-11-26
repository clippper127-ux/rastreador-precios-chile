import { foldText } from "../search";

/*
 * Tienda y cupones mencionados en un mensaje de ofertas (sin IA, por patrones):
 * - tienda: "#Tottus", "🎯 Ikea", nombres conocidos en el texto o el dominio de los links;
 * - cupones: "cupón ABC123", "código: XYZ", "🎟️ *BOLSADOBLE30* : $30.000 off en compras desde $350.000".
 */

/** Tiendas conocidas (nombre visible → variantes como aparecen en los mensajes, sin tildes y en minúsculas). */
const STORES: [string, string[]][] = [
  ["Falabella", ["falabella", "cmr"]],
  ["Paris", ["paris", "paris.cl"]],
  ["Ripley", ["ripley"]],
  ["Lider", ["lider", "walmart"]],
  ["Jumbo", ["jumbo"]],
  ["Santa Isabel", ["santa isabel"]],
  ["Tottus", ["tottus"]],
  ["Unimarc", ["unimarc"]],
  ["Sodimac", ["sodimac", "homecenter"]],
  ["Easy", ["easy"]],
  ["Hites", ["hites"]],
  ["La Polar", ["la polar", "lapolar"]],
  ["Abcdin", ["abcdin", "abc din"]],
  ["PC Factory", ["pc factory", "pcfactory"]],
  ["Mercado Libre", ["mercado libre", "mercadolibre", "meli"]],
  ["AliExpress", ["aliexpress", "ali express"]],
  ["Temu", ["temu"]],
  ["Shein", ["shein"]],
  ["Amazon", ["amazon"]],
  ["Ikea", ["ikea"]],
  ["Preunic", ["preunic"]],
  ["Salcobrand", ["salcobrand"]],
  ["Cruz Verde", ["cruz verde", "cruzverde"]],
  ["Farmacias Ahumada", ["ahumada"]],
  ["Corona", ["corona"]],
  ["Adidas", ["adidas"]],
  ["Nike", ["nike"]],
  ["Samsung", ["samsung store", "tienda samsung"]],
  ["PedidosYa", ["pedidosya", "pedidos ya"]],
  ["Uber Eats", ["uber eats", "ubereats"]],
  ["Rappi", ["rappi"]],
  ["Spid", ["spid"]],
  ["Dafiti", ["dafiti"]],
  ["Yauras", ["yauras"]],
  ["Trial", ["trial"]],
  ["Lápiz López", ["lapiz lopez"]],
  ["Entel", ["entel"]],
  ["Wom", ["wom"]],
];

/** Dominios que no son la tienda (agregadores, acortadores, afiliados). */
const NOT_STORE_HOSTS = /(^|\.)(ofertitas|bunnymoney|soicos|knasta|solotodo|stilo|bit|t|telegram|google|cutt|tinyurl|linktr|shorturl|tidd|clk|awin1|go)\./i;

/** Acortadores propios de una tienda. */
const HOST_STORE: [RegExp, string][] = [
  [/(^|\.)meli\.la$|mercadolibre\./i, "Mercado Libre"],
  [/(^|\.)(a|s\.click)\.aliexpress\./i, "AliExpress"],
  [/(^|\.)amzn\.to$/i, "Amazon"],
];

const norm = (s: string) => ` ${foldText(s).replace(/[^a-z0-9ñ.]+/g, " ").trim()} `;

/** Tienda mencionada en el mensaje, o undefined si no se puede saber. */
export function detectStore(text: string, links: string[] = []): string | undefined {
  // Formato de bots de ofertas: "#Tottus", "🎯 Ikea".
  const tag = text.match(/#([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]{1,30})/)?.[1] ?? text.match(/🎯\s*([^\n|]{2,30})/)?.[1]?.trim();
  if (tag) {
    const known = STORES.find(([, v]) => v.some((x) => norm(tag).includes(` ${x} `) || norm(tag).trim() === x));
    return known?.[0] ?? tag;
  }
  const t = norm(text);
  const hit = STORES.find(([, v]) => v.some((x) => t.includes(` ${x} `)));
  if (hit) return hit[0];
  // Links del mensaje y los que vienen escritos en el texto.
  const all = [...links, ...(text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])];
  for (const l of all) {
    try {
      const host = new URL(l).hostname.replace(/^www\./, "");
      const own = HOST_STORE.find(([re]) => re.test(host));
      if (own) return own[1];
      if (NOT_STORE_HOSTS.test(`.${host}.`) || NOT_STORE_HOSTS.test(host)) continue;
      const byHost = STORES.find(([, v]) => v.some((x) => host.replace(/[.-]/g, " ").includes(x.replace(/\./g, " "))));
      if (byHost) return byHost[0];
      return host;
    } catch {
      /* link inválido */
    }
  }
  return undefined;
}

export interface Coupon {
  code: string;
  /** Lo que da: "$30.000 off en compras desde $350.000", "20% en tecnología"... */
  benefit?: string;
  minPurchase?: number;
}

/** Palabras en mayúsculas que no son códigos. */
const NOT_CODES = new Set(
  "DISPONIBLE DISPONIBLES AGOTADO AGOTADOS STOCK PARA PARAHOY ESTE ESTA ESTOS ESTAS AQUI ACA VALIDO VALIDOS TIENDA TIENDAS OFF CLP HOY GRATIS BLACK FRIDAY CYBER CYBERDAY DAY ENVIO DSCTO DCTO CUPON CUPONES CODIGO CODIGOS CODE LINK VER PRODUCTO HTTPS HTTP WWW OFERTA OFERTAS SALE PROMO NUEVO NUEVA TODO TODOS APP WEB CMR USD SIN CON DESDE HASTA EXTRA FULL MAX MIN"
    .split(" "),
);

function validCode(c: string, strict: boolean): boolean {
  if (c.length < 4 || c.length > 24 || NOT_CODES.has(c.toUpperCase())) return false;
  if (!/[A-Za-z]/.test(c)) return false;
  if ((c.match(/-/g) ?? []).length > 1) return false; // "MIERCOLES-25-DE-NOVIEMBRE" es la ruta de un link
  // Sin la palabra "cupón/código" delante, exige mayúsculas (como se escriben los códigos).
  return strict ? /^[A-Z0-9][A-Z0-9_-]+$/.test(c) && (/\d/.test(c) || c.length >= 6) : /^[A-Za-z0-9][A-Za-z0-9_-]+$/.test(c);
}

function minPurchaseOf(s: string): number | undefined {
  const m = s.match(/(?:desde|sobre|m[ií]nim[oa](?: de)?|compras? (?:de|sobre|desde))\s*\$\s?(\d{1,3}(?:\.\d{3})+|\d{4,})/i);
  return m ? Number(m[1]!.replace(/\./g, "")) : undefined;
}

const clean = (s: string) =>
  s
    .replace(/[*_~`]/g, "")
    .replace(/^[\s:=\-–—→>|]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

/** Cupones del mensaje (sin repetir). */
export function extractCoupons(text: string): Coupon[] {
  const out = new Map<string, Coupon>();
  const add = (code: string, rest: string) => {
    const key = code.toUpperCase();
    if (out.has(key)) return;
    const benefit = clean(rest) || undefined;
    out.set(key, { code: key, benefit, minPurchase: minPurchaseOf(rest) });
  };
  // Los links no traen códigos (y sus rutas parecen códigos).
  for (const line of text.replace(/https?:\/\/\S+/g, " ").split(/\n+/)) {
    // "cupón: ABC123 …", "código XYZ para …", "usa el code SAVE10"
    for (const m of line.matchAll(/(?:cup[oó]n(?:es)?|c[oó]digos?|code)(?![a-z])\s*(?:de descuento)?\s*[:=\-–]?\s*[*_"“'`]*([A-Za-z0-9][A-Za-z0-9_-]{3,23})[*_"”'`]*/gi)) {
      // Tras "cupón/código" el código suele llevar números ("ahorro10") o ir en mayúsculas largas ("NAVIDAD").
      const c = m[1]!;
      if (validCode(c, false) && (/\d/.test(c) || (/^[A-Z]{6,}$/.test(c) && !NOT_CODES.has(c))))
        add(c, line.slice((m.index ?? 0) + m[0].length));
    }
    // "🎟️ *BOLSADOBLE30* : $30.000 off …" (código en negrita o al inicio, seguido de ":" o "-")
    const m2 = line.match(/^[^\wÁÉÍÓÚáéíóú]*[*_`]*([A-Z0-9][A-Z0-9_-]{3,23})[*_`]*\s*[:=\-–→]\s*(.+)$/);
    if (m2 && validCode(m2[1]!, true)) add(m2[1]!, m2[2]!);
  }
  return [...out.values()];
}

const DEAD_RE = /no\s+(me\s+|nos\s+)?(lo\s+|la\s+)?(funciona|funcion[oó]|sirve|sirvi[oó]|aplica|aplic[oó]|toma|tom[oó]|deja|dej[oó]|valid[oó]|pesc[oó])|agotad|expir|vencid|venci[oó]|caduc|ya\s+no\s+(est[aá]|hay|funciona|sirve|aplica)|se\s+acab|termin[oó]|invalid|no\s+v[aá]lido/i;

/** ¿El mensaje dice que este código ya no funciona? (en la misma línea del código o en un mensaje corto). */
export function couponLooksDead(text: string, code: string): boolean {
  const lines = text.split(/\n+/);
  const withCode = lines.filter((l) => l.toUpperCase().includes(code.toUpperCase()));
  const scope = text.length <= 200 ? [text] : withCode;
  return scope.some((l) => DEAD_RE.test(foldText(l)));
}
