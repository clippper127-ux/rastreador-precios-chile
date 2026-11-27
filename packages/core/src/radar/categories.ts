import { foldText } from "../search";

/*
 * Categorías de ofertas por palabras del mensaje (sin IA). Sirven para filtrar los avisos que no pediste
 * explícitamente (ofertas destacadas y errores de precio): "solo estas" y "nunca estas".
 * Un mensaje puede caer en varias categorías; si no reconoce ninguna, queda "sin categoría".
 */

export const DEAL_CATEGORIES = {
  ropa_interior: {
    label: "Ropa interior",
    words: ["sosten", "sostenes", "brasier", "bralette", "calzon", "calzones", "calzoncillo", "calzoncillos", "boxer", "boxers", "panty", "pantys", "colaless", "lenceria", "bikini", "trikini", "body", "faja", "peto deportivo", "ropa interior"],
  },
  ropa: {
    label: "Ropa",
    words: ["polera", "poleras", "camisa", "camisas", "pantalon", "pantalones", "jeans", "jean", "chaqueta", "parka", "poleron", "polerones", "vestido", "falda", "short", "shorts", "traje", "blusa", "tejido", "sweater", "chaleco", "calcetines", "pijama", "buzo", "calza", "calzas", "abrigo", "cortaviento", "jardinera", "enterito"],
  },
  calzado: {
    label: "Calzado",
    words: ["zapatilla", "zapatillas", "zapato", "zapatos", "bototo", "botin", "botines", "bota", "botas", "sandalia", "sandalias", "chala", "chalas", "pantufla", "pantuflas"],
  },
  accesorios: {
    label: "Bolsos y accesorios",
    words: ["mochila", "cartera", "bolso", "billetera", "reloj", "lentes de sol", "gafas", "cinturon", "jockey", "gorro", "bufanda", "maleta", "joya", "aros", "collar", "pulsera"],
  },
  tecnologia: {
    label: "Tecnología",
    words: ["notebook", "laptop", "celular", "smartphone", "iphone", "galaxy", "xiaomi", "tablet", "ipad", "audifonos", "airpods", "monitor", "tv", "televisor", "smart tv", "consola", "ps5", "playstation", "xbox", "nintendo", "switch", "cable", "cargador", "mouse", "teclado", "ssd", "disco duro", "pendrive", "parlante", "smartwatch", "motorola", "huawei", "honor", "oppo", "realme", "pixel", "razr", "lenovo", "asus", "acer", "hp", "dell", "camara", "impresora", "router", "gamer", "memoria ram", "power bank"],
  },
  electrohogar: {
    label: "Electrohogar",
    words: ["refrigerador", "lavadora", "secadora", "microondas", "horno", "airfryer", "freidora", "aspiradora", "cafetera", "licuadora", "hervidor", "ventilador", "estufa", "calefactor", "aire acondicionado", "batidora", "plancha", "lavavajillas", "congelador", "robot aspiradora"],
  },
  hogar: {
    label: "Hogar y muebles",
    words: ["sabanas", "plumon", "almohada", "toalla", "toallas", "sillon", "sofa", "colchon", "mesa", "silla", "lampara", "cortina", "olla", "ollas", "sarten", "vajilla", "cuchillo", "organizador", "alfombra", "velador", "escritorio", "closet", "comoda"],
  },
  belleza: {
    label: "Belleza y cuidado personal",
    words: ["bloqueador", "protector solar", "perfume", "colonia", "shampoo", "acondicionador", "crema", "maquillaje", "labial", "serum", "desodorante", "cepillo de dientes", "cepillo dental", "pasta dental", "afeitadora", "rasuradora", "secador de pelo", "plancha de pelo", "eucerin", "isdin", "la roche", "cerave", "nivea", "loreal"],
  },
  salud: {
    label: "Farmacia y salud",
    words: ["comprimidos", "capsulas", "jarabe", "medicamento", "vitamina", "vitaminas", "suplemento", "proteina", "colageno", "paracetamol", "ibuprofeno", "mascarilla", "termometro"],
  },
  supermercado: {
    label: "Supermercado y bebidas",
    words: ["vino", "cerveza", "pisco", "whisky", "ron", "aceite", "arroz", "fideos", "cafe", "leche", "detergente", "papel higienico", "toalla de papel", "lavaloza", "suavizante", "chocolate", "galletas", "bebida", "jugo", "atun", "cloro"],
  },
  bebe: {
    label: "Bebé",
    words: ["panales", "pañales", "coche", "cuna", "mamadera", "chupete", "toallitas humedas", "silla de auto", "bebe"],
  },
  juguetes: {
    label: "Juguetes",
    words: ["lego", "juguete", "juguetes", "muneca", "muñeca", "hot wheels", "barbie", "peluche", "puzzle", "rompecabezas", "juego de mesa", "funko"],
  },
  deporte: {
    label: "Deporte y aire libre",
    words: ["bicicleta", "mancuerna", "mancuernas", "trotadora", "pelota", "carpa", "saco de dormir", "patineta", "scooter", "pesas", "yoga", "camping"],
  },
  herramientas: {
    label: "Herramientas y construcción",
    words: ["taladro", "atornillador", "herramienta", "herramientas", "sierra", "esmeril", "hidrolavadora", "escalera", "pintura", "llave", "set de puntas"],
  },
  mascotas: {
    label: "Mascotas",
    words: ["perro", "perros", "gato", "gatos", "mascota", "mascotas", "arena sanitaria", "pedigree", "whiskas", "dog chow", "cat chow", "royal canin"],
  },
} as const satisfies Record<string, { label: string; words: string[] }>;

export type DealCategory = keyof typeof DEAL_CATEGORIES;
export const DEAL_CATEGORY_IDS = Object.keys(DEAL_CATEGORIES) as DealCategory[];

const norm = (s: string) => ` ${foldText(s).replace(/[^a-z0-9ñ]+/g, " ").trim()} `;

/** Categorías que menciona un texto (por palabra completa, sin tildes). */
export function dealCategories(text: string): DealCategory[] {
  const t = norm(text);
  return DEAL_CATEGORY_IDS.filter((c) => DEAL_CATEGORIES[c].words.some((w) => t.includes(norm(w))));
}

/** ¿El texto contiene alguna de estas palabras (palabra completa, sin tildes)? */
export function containsAnyWord(text: string, words: string[]): string | undefined {
  const t = norm(text);
  return words.find((w) => norm(w).trim() && t.includes(norm(w)));
}

/**
 * ¿Se filtra este mensaje? Primero "nunca" (categorías o palabras bloqueadas), después "solo estas"
 * (si la lista no está vacía, el mensaje debe caer en alguna).
 */
export function blockedByFilters(
  text: string,
  f: { include: string[]; exclude: string[]; blockWords: string[] },
): { blocked: boolean; why?: string } {
  const cats = dealCategories(text);
  const ex = cats.find((c) => f.exclude.includes(c));
  if (ex) return { blocked: true, why: DEAL_CATEGORIES[ex].label };
  const w = containsAnyWord(text, f.blockWords);
  if (w) return { blocked: true, why: `"${w}"` };
  if (f.include.length && !cats.some((c) => f.include.includes(c))) return { blocked: true, why: "fuera de tus categorías" };
  return { blocked: false };
}
