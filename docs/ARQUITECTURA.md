# Propuesta de arquitectura y modelo de datos

> Estado: **pendiente de aprobación**. Basado en `SPEC.md`. Fecha: 2026-11-24.

## 1. Resumen

Mantengo casi todo lo del spec. Los cambios están en la sección 2. En pocas palabras:

```
[Navegador + Extensión (unpacked)] ──► [apps/web · Next.js en Vercel Hobby] ──► [Supabase Free: Postgres + Auth]
                                                                                    ▲
                 [apps/worker · GitHub Actions cron en repo PRIVADO  |  Docker local] ──► Tiendas / APIs
                                         │
                                         └──► Telegram · Resend · Healthchecks.io · Sentry
```

- **packages/core**: tipos, interfaz `StoreAdapter`, adaptadores, motor de extracción (schema.org → JSON embebido → CSS/XPath/regex/JSONPath), lógica de precios (mejor precio sin/con tarjeta, deal score, descuento falso), reglas de alertas. Sin dependencias de Next ni de la DB, testeable con fixtures.
- **packages/db**: esquema Drizzle, migraciones, políticas RLS en SQL, helpers de consulta.
- **apps/web**: UI + Route Handlers (`/api/ingest` para la extensión, `/api/telegram/webhook`).
- **apps/worker**: `worker:once` (una pasada) y `worker:loop` (modo B). Mismo código.
- **apps/extension**: MV3, content scripts por tienda que reutilizan los parsers de `packages/core`.

## 2. Cambios que propongo (cosas del spec que son mala idea o tienen trampa)

### 2.1 Repo **privado**, no público
El spec propone repo público para minutos ilimitados. Tres problemas:
1. **Los logs de Actions en un repo público los ve cualquiera**: qué productos sigues, URLs, errores con datos.
2. **Los artifacts también**: el respaldo `pg_dump` semanal como artifact quedaría descargable por cualquier usuario de GitHub. Eso es tu base de datos completa.
3. En repos públicos los workflows con `schedule` **se desactivan solos tras 60 días sin actividad** en el repo (que el worker escriba en la DB no cuenta), y GitHub no avisa.

Con repo privado tienes 2.000 min/mes gratis. Cálculo: una pasada con `fetch` dura ~1–2 min (GitHub redondea cada job al minuto). Cada 4 h = 180 pasadas/mes ≈ 200–400 min. Con Playwright cacheado y solo para algunas tiendas, sigue lejos del límite. El worker registra los minutos usados y el panel de estado los muestra; si nos acercamos al 80 %, baja la frecuencia automáticamente.

### 2.2 RLS no protege nada si la app usa Drizzle con `DATABASE_URL`
Drizzle se conecta como rol `postgres`, que **se salta RLS**. Propuesta:
- Todo el acceso a datos ocurre en el servidor (Server Components / Route Handlers / worker) con Drizzle, y **siempre** filtrado por `user_id` mediante un helper (`db.forUser(userId)`), nunca consultas sueltas.
- RLS activado igual en **todas** las tablas, con políticas restrictivas para `anon` y `authenticated`. Es defensa en profundidad: la anon key de Supabase es pública y sin RLS cualquiera podría leer la DB con ella.
- Supabase Auth (`@supabase/ssr`) se usa solo para la sesión (magic link + Google).

Esto también deja la puerta abierta a Neon sin reescribir nada.

### 2.3 Desarrollo local: Supabase CLI en vez de un Postgres a mano
Un Postgres suelto en Docker Compose no trae Auth, así que el login no funcionaría en local. Opciones:
- **Recomendada:** un segundo proyecto Supabase Free como entorno "dev" (el plan permite 2 activos). Cero Docker para empezar, útil en Windows.
- Alternativa: `supabase start` (CLI, usa Docker por debajo).

Docker Compose queda solo para el worker en modo B.

### 2.4 Mercado Libre: no contar con el endpoint de búsqueda
Hay reportes de desarrolladores desde 2024 de que `/sites/{site}/search` devuelve 403 incluso con token, mientras otros endpoints funcionan. No hay confirmación oficial ni datos específicos de Chile. Plan:
- Fase 1 lo prueba primero con tus credenciales.
- Para el **seguimiento** (lo importante) se usa `/items?ids=` con token, que debería seguir funcionando. Hay que confirmarlo también.
- Si la búsqueda está cerrada, ML pasa a "búsqueda por link + extensión" como Falabella.

### 2.5 Extensión: cargarla "unpacked", no publicarla en Chrome Web Store
Publicar en Chrome Web Store cobra USD 5 de registro, lo que rompe el requisito de "100 % gratis". Se instala en modo desarrollador desde `apps/extension/dist`. Si luego quieres publicarla, lo decides tú.

### 2.6 Historial "solo cuando cambia": las estadísticas deben ponderarse por tiempo
Si solo guardamos cambios, una mediana simple sobre los snapshots está sesgada: un precio que duró 1 hora pesa igual que uno que duró 2 meses. Toda la lógica de precios (percentiles, mediana 60–90 días, descuento falso, "duelo de tiendas") se calcula **ponderada por duración**, usando `last_checked_at` como cierre del último tramo. Además, "faltan datos" se mide en días de **cobertura real** (días con chequeo), no en días desde el primer snapshot.

### 2.7 Límite por dominio global, no por proceso
"Máximo N requests por minuto por tienda" tiene que valer aunque haya dos runners a la vez (Actions + tu PC). Se resuelve en Postgres: tabla `store_rate` con `next_allowed_at`, que se toma con `SELECT … FOR UPDATE`, más `concurrency:` en el workflow para que no se solapen dos pasadas.

### 2.8 Email con Resend: solo a tu propio correo sin dominio propio
Sin un dominio verificado, Resend solo envía a la dirección de la cuenta. Para uso personal basta. Si quieres que lleguen correos a otros usuarios, hace falta un dominio, que **cuesta dinero**. Telegram queda como canal principal, como dice el spec.

### 2.9 Un listing sirve a todos los usuarios
`products`, `listings` y `price_snapshots` son **compartidos**: si dos usuarios siguen el mismo producto en Paris, se consulta una sola vez. Lo personal (precio objetivo, tiendas marcadas, canales) vive en `watches` y `watch_listings`. Esto agrega una tabla al spec (`watch_listings`) porque tú eliges qué tiendas seguir **por producto**.

## 3. Límites de los planes gratis (verificados hoy)

| Servicio | Límite relevante | ¿Nos afecta? |
|---|---|---|
| Supabase Free | 500 MB de DB por proyecto, 2 proyectos activos, 5 GB egress, 50k MAU. Se pausa tras ~1 semana con poca actividad en la DB | No: el worker escribe varias veces al día. El panel avisa si pasan más de 48 h sin pasada. |
| GitHub Actions (privado) | 2.000 min/mes | Estimado 200–400 min/mes. |
| GitHub Actions (público) | Ilimitado, pero cron se desactiva tras 60 días sin actividad y los logs y artifacts son públicos | Por esto recomiendo repo privado. |
| Vercel Hobby | Uso personal no comercial. Cron: la doc oficial dice 1 vez al día; una doc nueva (beta) habla de cada 15 min. Hay contradicción | No usamos el cron de Vercel. |
| Resend Free | 100 emails/día, 3.000/mes | Sobra para alertas y el resumen semanal. |
| Healthchecks.io / Sentry | Planes gratis suficientes para 1–3 checks y bajo volumen de errores | Pendiente de confirmar al configurarlos (Fase 2). |
| Mercado Libre API | Registro gratis. Búsqueda posiblemente cerrada (ver 2.4) | Se confirma en Fase 1. |

Fuentes: [Supabase – pausa de proyectos](https://supabase.com/kb/faqs/platform/free-project-pausing), [Supabase – límite de 500 MB](https://supabase.com/changelog/33121-relaxing-database-size-limit-on-free-plan-0-5-gb-database-size-per-project), [GitHub – workflows desactivados](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows), [GitHub – billing de Actions](https://docs.github.com/en/actions/reference/usage-limits-billing-and-administration), [Vercel – cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Vercel – Schedules limits](https://vercel.com/docs/schedules/limits), [Resend – cuotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Reclame Aqui – 403 en búsqueda ML](https://www.reclameaqui.com.br/mercado-livre/erro-403-forbidden-no-endpoint-de-busca-publica-de-anuncios-da-api-do-mercado-livre_kl_Q1h2_x_sPnREJ/).

## 4. Modelo de datos

Precios en **enteros CLP** (`integer`). Fechas en `timestamptz`. IDs `uuid`, salvo snapshots (`bigint identity`, la tabla que más crece).

### Usuarios
**`profiles`** (1:1 con `auth.users`)
- `id` uuid PK → auth.users
- `display_name`, `comuna`, `timezone` (default `America/Santiago`)
- `telegram_chat_id` bigint null: se vincula con `/start <token>` al bot
- `email_alerts` bool, `weekly_digest` bool
- `extension_token_hash` text: el token de la extensión se guarda hasheado y se puede rotar
- `is_admin` bool
- `created_at`

### Tiendas (`store_config` + `store_health` en una tabla)
**`stores`**
- `id` text PK (`'paris'`, `'falabella'`…), `name`, `domain`, `enabled`
- `source_chain` text[]: orden de fuentes, p. ej. `{api,server,extension,manual}`
- `search_mode` enum `server | link`
- `search_url_template` text: para el botón "Buscar en X"
- `min_check_interval_min` int, `max_requests_per_min` int, `paused` bool
- Estado: `status` enum `ok | degraded | blocked`, `backoff_level` int, `blocked_until`, `last_success_at`, `last_error_at`, `last_error`

**`store_rate`**: `store_id` PK, `next_allowed_at` (rate limit global, ver 2.7)

**`extraction_strategies`** (idea de PriceBuddy, Fase 6)
- `id`, `store_id`, `kind` enum `schema_org | next_data | css | xpath | regex | jsonpath`
- `config` jsonb (selectores/rutas por campo), `priority` int
- `status` enum `proposed | approved | disabled`, `origin` enum `builtin | human | ai`
- `created_at`, `approved_at`

**`fetch_runs`**: log por pasada (`started_at`, `finished_at`, `runner` (`gha|local`), `listings_checked`, `errors`, `minutes_used`). Alimenta el panel de estado.

### Catálogo (compartido)
**`products`**: producto canónico
- `id`, `canonical_name`, `brand`, `model`, `variant` jsonb (capacidad, color, talla…), `ean` (índice único parcial), `category`, `image_url`
- `unit_qty` numeric + `unit` text (precio por unidad, Fase 7)
- `created_at`

**`listings`**: una publicación en una tienda
- `id`, `product_id`, `store_id`, `url` (única, normalizada sin tracking), `external_id`/`sku`, `ean`, `title`
- `seller`, `seller_type` enum `official | store | third_party`, `seller_reputation` text
- Estado actual (desnormalizado para el dashboard): `price_normal`, `price_offer`, `price_card`, `card_name`, `stock_status` enum `in_stock | preorder | out_of_stock | discontinued | unknown`, `shipping_info`, `last_source`
- `last_changed_at`, `last_checked_at`
- Cola: `next_check_at`, `attempts`, `locked_until`, `last_error`
- `status` enum `active | archived`. Se archiva cuando ningún watch activo lo usa.

**`price_snapshots`**: solo se inserta si cambia precio o stock
- `id` bigint, `listing_id`, `observed_at`
- `price_normal`, `price_offer`, `price_card`, `card_name`, `stock_status`
- `source` enum `api | feed | pricto | server | ai | extension | manual`
- `reported_by` uuid null (usuario, para extension/manual)
- Índice `(listing_id, observed_at desc)`

Estimación: 200 listings × ~1 cambio/día × 365 ≈ 73k filas/año ≈ 10–15 MB. Los 500 MB alcanzan para años.

### Lo personal
**`watches`**: un usuario sigue un producto
- `id`, `user_id`, `product_id` (único por usuario)
- `target_price` int null, `drop_pct` numeric null, `notify_all_time_low` bool, `notify_restock` bool
- `price_basis` enum `no_card | with_card`: con qué precio comparar
- `exclude_third_party` bool, `channels` text[] (`telegram`, `email`), `active` bool
- `collection_id` null (Fase 7), `created_at`

**`watch_listings`**: qué tiendas sigues de ese producto
- `watch_id`, `listing_id`, `enabled`, PK compuesta

**`alerts`**: avisos enviados, sin repetir
- `id`, `user_id`, `watch_id`, `listing_id`, `snapshot_id`
- `kind` enum `target | drop_pct | all_time_low | restock`
- `dedupe_key` text **único**: p. ej. `target:{watch}:{listing}:{snapshot_id}`
- `channel`, `status` enum `pending | sent | failed`, `sent_at`, `payload` jsonb

Regla anti-spam: la alerta de "bajo el objetivo" se **rearma** solo cuando el precio vuelve a subir sobre el objetivo, para no avisar en cada chequeo mientras siga bajo.

### Fases posteriores
- `collections` (`user_id`, `name`, `budget`) — Fase 7
- `sale_events` (`name`, `starts_on`, `ends_on`, `check_interval_min`) — Fase 7, editable desde admin
- `llm_usage` (`day`, `calls`, `tokens`) — tope diario de IA, Fase 5
- `tags` / `watch_tags` — Fase 7

### RLS
- `profiles`, `watches`, `watch_listings`, `alerts`, `collections`: el usuario solo ve y edita lo suyo (`user_id = auth.uid()`).
- `products`, `listings`, `price_snapshots`, `stores`: lectura para `authenticated`; escritura solo servidor (service role / conexión directa).
- `extraction_strategies`, `fetch_runs`, `store_rate`, `llm_usage`: sin acceso para `anon`/`authenticated`.

## 5. Flujo del worker (una pasada)

1. Registra el inicio en `fetch_runs` y hace ping de inicio a Healthchecks.
2. Toma hasta N listings con `next_check_at <= now()` y `locked_until < now()`, de tiendas no pausadas ni bloqueadas, con `FOR UPDATE SKIP LOCKED`, y los marca con `locked_until = now() + 10 min`.
3. Por tienda (en paralelo entre tiendas, en serie dentro de cada una): espera el turno en `store_rate` y recorre `source_chain` hasta que una fuente devuelva datos válidos.
4. Si hay bloqueo (403/429, página de desafío, HTML sin producto), sube `backoff_level` de la tienda, fija `blocked_until` (exponencial: 1 h, 2 h, 4 h… tope 48 h) y deja de intentar esa tienda en esta pasada.
5. Compara con el estado actual del listing: si cambió, inserta un snapshot. Siempre actualiza `last_checked_at` y `next_check_at`.
6. Evalúa reglas de alerta para los watches afectados, inserta `alerts` (el `dedupe_key` único evita duplicados) y envía.
7. Cierra `fetch_runs` y hace ping de éxito.

## 6. Fases

Igual que el spec, con un único ajuste: en **Fase 0** el "Docker Compose (web + worker + Postgres)" se reemplaza por Supabase dev en la nube (ver 2.3) y Docker queda solo para el modo B del worker.

Al empezar la Fase 0 te pediré permiso antes de instalar las skills (`npx skills add vercel-labs/agent-skills`) y antes de crear cualquier cuenta o repo. Esas cuentas las creas tú (GitHub, Vercel, Supabase, bot de Telegram con BotFather y app de Mercado Libre) y me pasas las claves por `.env`, nunca por el chat.

## 6b. Resultado del sondeo de tiendas (Fase 1, 2026-11-24)

Detalle en [sondeo-tiendas.md](sondeo-tiendas.md). Se hizo desde una IP residencial con User-Agent honesto. Hay que repetirlo desde GitHub Actions cuando exista el repo, porque las IPs de servidor suelen bloquearse más.

| Estrategia | Tiendas | Por qué |
|---|---|---|
| **Servidor (activo)** | Hites, La Polar, Abcdin | Salesforce Commerce Cloud. JSON-LD Product + bloque `.prices`. Un solo adaptador (`adapters/sfcc.ts`). La Polar y Abcdin prohíben `/search` en robots.txt → búsqueda por link. |
| **Servidor (Fase 6)** | Jumbo, Santa Isabel, PC Factory | VTEX con JSON-LD en búsqueda y ficha. PC Factory: fichas permitidas, búsqueda no. |
| **API oficial** | Mercado Libre | Sin credenciales responde 403 incluso en `/items`. Falta registrar la app (OAuth). |
| **Extensión** | Falabella, **Paris**, Ripley, Lider, Tottus, Sodimac, SP Digital | 403 o desafío anti-bot. |

**Cambio respecto al spec:** el spec ponía **Paris** como tienda de servidor para la Fase 1. Paris bloquea al worker con 403 incluso en `robots.txt`. Otra herramienta con el mismo User-Agent sí recibió 200, lo que indica un filtro por huella técnica del cliente. Cambiar de cliente para pasar ese filtro sería eludir su protección, así que Paris pasa a la extensión. En su lugar, la Fase 1 cubre **Hites, La Polar y Abcdin** con un adaptador compartido.

## 7. Decisiones que necesito de ti

1. ¿Apruebas la arquitectura y el modelo de datos?
2. ¿Repo **privado** (recomendado) o público?
3. ¿Uso personal solo tuyo, o multiusuario real desde el inicio? El modelo ya soporta multiusuario. La pregunta es si la UI de Fase 0 lo necesita.
