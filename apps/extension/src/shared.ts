import type { CapturedProduct } from "@rastreador/core";

export interface Settings {
  apiUrl: string;
  token: string;
  collapsed?: boolean;
}

export const DEFAULT_API = "http://localhost:3000";

export async function getSettings(): Promise<Settings> {
  const s = (await chrome.storage.local.get(["apiUrl", "token", "collapsed"])) as Partial<Settings>;
  return { apiUrl: (s.apiUrl || DEFAULT_API).replace(/\/+$/, ""), token: s.token ?? "", collapsed: s.collapsed };
}

export type Msg =
  | { type: "capture"; capture: CapturedProduct; follow: boolean }
  | { type: "ping" };

export interface IngestResponse {
  tracked?: boolean;
  changed?: boolean;
  productId?: string;
  storeName?: string;
  minPrice90d?: number;
  points?: { t: number; price: number }[];
  error?: string;
  /** Agregado por el background: dirección de la app para el link "Ver en Rastreador". */
  appUrl?: string;
  status?: number;
}
