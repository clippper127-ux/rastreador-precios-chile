# Sondeo de tiendas

Generado: 2026-11-24T22:17:56.754Z · Origen: **PC local (IP residencial)** · Búsqueda de prueba: "audifonos bluetooth"

Generado por `pnpm --filter @rastreador/worker probe`. Pocas requests, 3 s entre requests por tienda, robots.txt respetado.

| Tienda | robots.txt | Búsqueda | Ficha de producto | Precio leído (JSON-LD) |
|---|---|---|---|---|
| Falabella | 200 | HTTP 200 · 2452 KB · JSON-LD: ItemList · ItemList: 56 · __NEXT_DATA__ · Next.js | 🚫 bloqueado (HTTP 403) | no |
| Ripley | error: HTTP 403 | 🚫 bloqueado (HTTP 403) | — | sin ficha |
| Paris | error: HTTP 403 | 🚫 bloqueado (HTTP 403) | — | sin ficha |
| Lider | 200 | 🚫 bloqueado (Página de desafío / anti-bot) | — | sin ficha |
| Sodimac | 200 | HTTP 200 · 294 KB · __NEXT_DATA__ · Next.js | — | sin ficha |
| Tottus | 200 | 🚫 bloqueado (HTTP 403) | — | sin ficha |
| Hites | 200 | HTTP 200 · 2715 KB · JSON-LD: ItemList, Organization, Store · ItemList: 36 · SFCC | HTTP 200 · 2134 KB · JSON-LD: Product, BreadcrumbList, Organization, Store · SFCC | $13.490 · in_stock |
| La Polar | 200 | 🚫 bloqueado (robots.txt no permite /search) | — | sin ficha |
| Abcdin | 200 | 🚫 bloqueado (robots.txt no permite /search) | — | sin ficha |
| PC Factory | 200 | 🚫 bloqueado (robots.txt no permite /buscar) | — | sin ficha |
| SP Digital | error: HTTP 503 | 🚫 bloqueado (HTTP 403) | — | sin ficha |
| Jumbo | 200 | HTTP 200 · 1355 KB · JSON-LD: ItemList · ItemList: 14 · VTEX | HTTP 200 · 1261 KB · JSON-LD: Product, BreadcrumbList · VTEX | $14.990 · in_stock<br>VTEX catálogo: HTTP 404, no JSON |
| Santa Isabel | 200, crawl-delay 1s | HTTP 200 · 849 KB · JSON-LD: ItemList · ItemList: 1 · VTEX | HTTP 200 · 987 KB · JSON-LD: Product, BreadcrumbList · VTEX | $7.990 · in_stock<br>VTEX catálogo: robots.txt no permite /api/catalog_system/pub/products/search |

## Mercado Libre (API, sin credenciales)

- Búsqueda pública (/sites/MLC/search): HTTP 403
- Ítem público (/items/{id}): HTTP 403
