# Prompt para Claude Code — Rastreador de precios Chile

> Copia todo lo que está bajo la línea en Claude Code. Si lo vas a usar como spec del repo, guárdalo como `SPEC.md` y dile a Claude Code: "lee SPEC.md y arma el plan".

---

## Contexto

Quiero construir una web app (tipo Distill Web Monitor, pero enfocada en compras) para hacer seguimiento de precios de productos en tiendas chilenas y comprar en el mejor momento.

La idea central: escribo en lenguaje natural lo que quiero ("PS5 Slim con lector", "Airfryer Philips 4 litros", "zapatillas Nike Pegasus 41 talla 42"), la app busca ese producto en las tiendas más populares y confiables de Chile, me muestra las coincidencias, yo confirmo cuáles seguir y desde ahí la app revisa los precios periódicamente y me avisa cuando conviene comprar.

Soy diseñador UX/UI, así que la experiencia y el diseño importan tanto como el backend.

## Antes de escribir código

1. Propón la arquitectura y el modelo de datos, y espera mi visto bueno.
2. Divide el trabajo en las fases de abajo. No avances de fase sin que la anterior funcione de punta a punta.
3. Si algo de este documento es técnicamente mala idea, dímelo y propón la alternativa.

## Stack

- **Frontend:** Next.js (App Router) + TypeScript, Tailwind, shadcn/ui, lucide-react, framer-motion.
- **Estilo visual:** esquinas redondeadas, sombras suaves, grilla limpia, títulos prominentes. Modo claro y oscuro. Mobile first.
- **Base de datos y auth:** Supabase (Postgres + Auth con magic link o Google).
- **Scraping:** Node + Playwright solo cuando haga falta renderizar; si la tienda expone datos estructurados, usar fetch directo.
- **Jobs programados:** worker en GitHub Actions con cron (ver "Infraestructura y despliegue"). Vercel Cron no sirve para esto.
- **Notificaciones:** bot de Telegram (principal) y email con Resend. Web push en fase posterior.
- **Gráficos:** Recharts.
- **Monorepo:** pnpm workspaces → `apps/web` (Next.js), `apps/worker` (Node), `apps/extension` (Chrome), `packages/core` (adaptadores, tipos, lógica de precios compartida), `packages/db` (esquema y migraciones).

## Infraestructura y despliegue (100% gratis)

**Requisito duro: todo debe funcionar sin pagar nada.** Nada de servicios con tarjeta obligatoria ni planes de prueba que expiran. Si alguna decisión obliga a pagar, detente y avísame antes.

La app se divide en piezas que corren en lugares distintos, porque el scraping no cabe en un hosting serverless:

```
[Navegador + Extensión] ──► [Web: Next.js en Vercel Hobby] ──► [Postgres: Supabase Free]
                                                                     ▲
                      [Worker: GitHub Actions cron  ó  mi computador] ──► Tiendas / APIs
                                         │
                                         └──► Telegram · Resend (email)
```

### 1. Web (Next.js) → Vercel Hobby (gratis)
- UI, auth, API routes (incluido el endpoint donde la extensión envía precios) y lectura de datos.
- **No** hace scraping ni tareas programadas: el cron de Hobby corre solo una vez al día y Playwright es demasiado pesado para serverless.
- Hobby es para uso personal no comercial: este proyecto es personal.

### 2. Base de datos y auth → Supabase Free
- 500 MB de base de datos alcanzan de sobra si el historial se guarda bien: **solo insertar un snapshot cuando cambia el precio o el stock**, más un "último chequeo" en el listing. Nada de guardar HTML.
- El plan gratis pausa proyectos tras una semana sin actividad; el worker escribe varias veces al día, así que no debería pasar. Igual, el panel de estado lo vigila.
- Alternativa gratis si Supabase molesta: Neon. Mantén el acceso a datos desacoplado (Drizzle ORM + `DATABASE_URL`).
- Respaldo semanal con `pg_dump` desde GitHub Actions, guardado como artifact o en un repo privado.

### 3. Worker (scraping + alertas) → gratis, en dos modos con el mismo código
El worker es un script Node que procesa una "pasada" (`npm run worker:once`): toma los listings que tocan revisar, los consulta respetando límites por dominio, guarda snapshots y manda alertas. El mismo código corre en:

- **Modo A — GitHub Actions con cron (principal):** cada 4–6 h, más seguido en fechas de eventos. Repo **público** para minutos ilimitados (sin secretos en el código; todo en GitHub Secrets) o privado vigilando la cuota mensual de minutos. Cachear el navegador de Playwright entre ejecuciones.
- **Modo B — mi computador (opcional):** `docker compose up worker` con un loop interno, para cuando quiera más frecuencia.
- Opcional a futuro: VM "Always Free" de Oracle Cloud, si hay capacidad disponible.
- Sin Redis: la "cola" es una tabla en Postgres con `next_check_at`, `attempts` y `locked_until`.

### 4. Servicios externos (todos con plan gratis)
- **Telegram bot** (canal principal de alertas, gratis sin límites prácticos).
- **Resend** para email, dentro del plan gratis.
- **Healthchecks.io** gratis: el worker hace ping en cada pasada; si deja de hacerlo, me avisa.
- **Sentry** gratis para errores.
- **IA opcional:** proveedor con plan gratis (por ejemplo Gemini) o Ollama local. **La app debe funcionar completa sin IA**: búsqueda con reglas + matching por EAN/SKU/título, y la IA solo mejora resultados.
- **Pricto opcional** con su plan gratis (100 créditos/mes): solo para supermercado/farmacia o tiendas donde no haya otra fuente.

### 5. Configuración y seguridad
- `.env.example` documentado: `DATABASE_URL`, claves de Supabase, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `LLM_API_KEY` (opcional), `PRICTO_API_KEY` (opcional), `ML_CLIENT_ID`/`ML_CLIENT_SECRET`, `HEALTHCHECK_URL`.
- El endpoint de la extensión valida un token por usuario, tiene rate limit y solo acepta URLs de tiendas soportadas.
- Row Level Security en Supabase.
- CI en GitHub Actions: lint, typecheck y tests de adaptadores con fixtures.

Verifica los límites vigentes de cada plan gratis antes de decidir y dímelo si alguno cambió.

## Tiendas objetivo (Chile) y estrategia por tienda

La IP de un servidor (GitHub Actions, Vercel) es la que más bloquean las tiendas grandes. Por eso cada tienda tiene una **estrategia distinta**, y la extensión no es un extra: es la fuente principal para las tiendas que bloquean.

| Tienda | Fuente principal | Respaldo | Búsqueda |
|---|---|---|---|
| **Mercado Libre** | API oficial (registrar app gratis en developers.mercadolibre.cl, OAuth) | Extensión | API, si el endpoint de búsqueda sigue disponible con mis credenciales; si no, extensión |
| **Falabella** | Extensión | Worker con fetch liviano a datos estructurados (`__NEXT_DATA__` / JSON-LD), baja frecuencia | Link de búsqueda + extensión |
| **Ripley** | Extensión | Worker con fetch liviano, baja frecuencia | Link de búsqueda + extensión |
| **Paris** | Worker (JSON-LD o API de su plataforma) | Extensión · Pricto | Worker |
| **Lider** | Extensión | Worker con fetch liviano | Link de búsqueda + extensión |
| **Sodimac / Tottus** | Extensión | Worker con fetch liviano | Link de búsqueda + extensión |
| **Hites, La Polar, Abcdin** | Worker | Extensión · Pricto | Worker |
| **PC Factory, SP Digital** | Worker | Extensión | Worker |
| **Jumbo, Santa Isabel** | Worker (API pública de catálogo de su plataforma, si existe) | Extensión · Pricto | Worker |

Esta tabla es mi hipótesis inicial. **Antes de programar cada adaptador**, prueba la tienda desde el worker (GitHub Actions) con pocas requests y reporta: qué datos estructurados expone, si responde o bloquea, y con eso ajusta la tabla en `store_config`.

### Cómo funciona la búsqueda en tiendas que bloquean
- Para tiendas marcadas como "búsqueda por extensión", la app **no** hace la búsqueda desde el servidor. Muestra botones "Buscar en Falabella / Ripley / Lider" que abren la búsqueda real de la tienda en una pestaña.
- Cuando estoy en la página de resultados o en la ficha de un producto, la extensión lee lo que ya estoy viendo, propone el match con el producto que estoy siguiendo y yo confirmo con un clic.
- Desde ahí, cada vez que visito esa ficha, la extensión actualiza el precio. El worker intenta además un chequeo liviano de baja frecuencia; si la tienda lo bloquea, se marca y se deja de intentar por un tiempo.
- En el dashboard, cada listing muestra "actualizado hace X" y un botón "abrir para actualizar" cuando el precio está viejo.

### Reglas para todas las tiendas
- Respetar `robots.txt`, máximo 1 request cada pocos segundos por dominio, User-Agent honesto, nada que requiera login.
- Preferir siempre datos estructurados (API, JSON-LD, JSON embebido) antes que parsear HTML.
- Guardar por separado precio normal, oferta y precio con tarjeta (CMR, Ripley, Cencosud).
- En Mercado Libre, guardar si es tienda oficial, si vende Mercado Libre o un tercero, y la reputación del vendedor.
- Agregar una tienda nueva = un archivo de adaptador + una fila en `store_config` + fixtures de prueba.

## Arquitectura de adaptadores

Cada tienda es un adaptador independiente con la misma interfaz:

```ts
interface StoreAdapter {
  id: string;                 // "falabella", "paris", ...
  name: string;
  domain: string;
  search(query: string): Promise<SearchResult[]>;
  getProduct(url: string): Promise<ProductSnapshot>;
}

interface ProductSnapshot {
  url: string;
  title: string;
  brand?: string;
  sku?: string;
  ean?: string;
  imageUrl?: string;
  priceNormal?: number;       // precio "antes"/normal
  priceOffer?: number;        // precio oferta / internet
  priceCard?: number;         // precio con tarjeta de la tienda (CMR, Ripley, Cencosud...)
  cardName?: string;
  inStock: boolean;
  seller?: string;            // marketplace: vendido por terceros vs la tienda
  isOfficialStore?: boolean;
  shippingInfo?: string;
  fetchedAt: Date;
}
```

Importante para Chile: guardar **por separado** precio normal, precio oferta y precio con tarjeta. Mostrar siempre el "mejor precio sin tarjeta" y el "mejor precio con tarjeta" como cosas distintas.

Si un adaptador falla (cambió el HTML, bloqueo, timeout), se registra el error, se marca la tienda como "degradada" en un panel de estado y no rompe el resto.

## Referencias y fuentes externas

### PriceBuddy (github.com/jez500/pricebuddy) — referencia de diseño, no dependencia

Tracker de precios open source y autoalojado (Laravel/PHP, licencia GPL-3.0). **No copies su código** (la GPL obligaría a liberar este proyecto con la misma licencia). Sí toma estas ideas y reimpleméntalas en nuestro stack:

- **Estrategias de extracción configurables por tienda, sin tocar código:** `schema_org`, selector CSS, XPath, regex y JSON path, guardadas en `store_config` y editables desde el panel admin. Orden: schema.org primero y los demás como respaldo.
- **IA solo como respaldo:** si la extracción falla, un LLM lee la página para recuperar título/precio/stock y **propone una estrategia nueva** para esa tienda, que yo apruebo antes de guardarla. Con presupuesto máximo de llamadas por día.
- **Deal score con veredicto:** "Buen momento para comprar / Buen precio / Promedio / Algo caro / Espera / Faltan datos". Usa percentiles del historial, el mínimo histórico y si es más barato que las otras tiendas. Mínimo 14 días de datos antes de dar un veredicto confiable; antes de eso, "Faltan datos".
- **Insights del producto:** estadísticas de precio, eventos de baja, disponibilidad, estacionalidad y "duelo de tiendas" (cuál fue más barata más días).
- **Estados de stock detallados:** en stock, preventa, sin stock, descontinuado.
- **Precio por unidad** (ej: pack de 10 vs pack de 3), útil para supermercado y farmacia.
- **Etiquetas, filtros y multiusuario.**
- **Extensión "companion":** panel en la página del producto con el historial, comparación con otras tiendas y la opción de corregir la estrategia de extracción de esa tienda ahí mismo.
- **API REST + servidor MCP** para consultar mis seguimientos desde un agente (fase opcional).

### Pricto (pricto.dev) — fuente de datos opcional

API chilena de precios (REST + MCP) con precio, oferta, precio con tarjeta, stock e historial, y el mismo ID de producto entre cadenas. Dice cubrir 125 tiendas (supermercados, farmacias, tecnología, hogar, etc.) incluyendo Paris, Hites y abcdin/La Polar, pero **no** Falabella, Ripley, Lider, Tottus ni Mercado Libre. Es un servicio nuevo y sin historial público, así que:

- Intégralo como **una fuente más** dentro de la cadena de cada tienda (`source: "pricto"`), detrás de la misma interfaz, nunca como dependencia central.
- Configurable por variable de entorno; si no hay API key, la app funciona igual.
- Respeta su sistema de créditos: usa `dry_run` para cotizar y `max_credits` como tope; caché agresivo. El plan gratis es muy chico (100 créditos/mes), así que úsalo primero para supermercado/farmacia donde aporta más.
- Revisa sus términos antes de mostrar sus precios a otros usuarios (tiene límites de display).

## Skills para Claude Code

Instalar antes de empezar: `npx skills add vercel-labs/agent-skills`. Usar:

- `vercel-react-best-practices` — al escribir componentes, data fetching y páginas de Next.js.
- `vercel-composition-patterns` — al armar el sistema de componentes (tarjetas de producto, tablas de precios).
- `web-design-guidelines` — revisión de accesibilidad y UX al cerrar cada fase con UI.
- `deploy-to-vercel` — despliegue y previews.
- `vercel-optimize` — después del lanzamiento, para revisar costos de funciones y cron.

(Las animaciones siguen con framer-motion; `vercel-react-view-transitions` es opcional para transiciones entre páginas.)

## Tiendas que bloquean bots

Algunas tiendas chilenas usan protección anti-bot (Cloudflare, Akamai, captchas) y bloquean sobre todo las IPs de servidores como GitHub Actions o Vercel. **No quiero saltarme esas protecciones**: nada de solvers de captcha, proxies rotativos, plugins "stealth" ni falsear el navegador. En vez de eso, cada tienda tiene una cadena de fuentes y la app usa la primera que funcione:

1. **API oficial** o de la plataforma de e-commerce (si existe y sus condiciones lo permiten).
2. **Feeds de productos o programas de afiliados** de la tienda, si los ofrece (investigar cuáles tienen en Chile), o **Pricto** si cubre esa tienda.
3. **Datos estructurados desde el servidor** (JSON-LD, `__NEXT_DATA__`) con fetch simple y baja frecuencia.
4. **Captura desde la extensión de navegador:** cuando yo visito la página del producto en mi navegador, la extensión lee el precio que ya estoy viendo y lo envía al backend como un snapshot más (con `source: "extension"`). Así las tiendas difíciles se actualizan con mis propias visitas, sin bots.
5. **Ingreso manual rápido:** botón "actualizar precio a mano" en el detalle del producto, para pegar el precio cuando nada más funciona.

Requisitos:
- Cada snapshot guarda su `source` (`api`, `feed`, `pricto`, `server`, `ai`, `extension`, `manual`) y se muestra en la UI con un indicador discreto.
- **Detección de bloqueo:** si una tienda responde 403/429, muestra una página de desafío o captcha, o devuelve HTML sin datos del producto, el adaptador lo marca como `blocked`. **No reintenta de forma agresiva**: aplica backoff exponencial y baja la frecuencia de esa tienda automáticamente.
- En la UI, un producto de una tienda bloqueada muestra "último precio conocido hace X horas" y un llamado a abrir la página (para que la extensión lo actualice) o a ingresarlo a mano.
- Configuración por tienda en un archivo o tabla (`store_config`): fuentes habilitadas en orden, frecuencia máxima y si está pausada.
- Por esto, **la extensión de navegador sube a la Fase 3**: es la fuente principal de Falabella, Ripley y Lider.

## Modelo de datos (propuesta base, mejórala)

- `users`
- `products` — producto "canónico" (ej: "PS5 Slim Digital"), con marca, modelo, EAN si existe.
- `listings` — una publicación concreta en una tienda, ligada a un `product`.
- `price_snapshots` — historial: listing_id, precios, stock, fecha.
- `watches` — lo que sigue cada usuario: product_id, precio objetivo, % de baja, canales de aviso, activo/pausado.
- `alerts` — avisos enviados (para no repetir).
- `store_health` — último éxito/error por tienda.

## Funciones

### Núcleo (MVP)

1. **Búsqueda en lenguaje natural.** Escribo lo que quiero; un LLM normaliza la consulta (marca, modelo, variante, capacidad, color, talla) y genera las búsquedas para cada tienda.
2. **Resultados agrupados.** Las publicaciones que son el mismo producto se agrupan (match por EAN/SKU primero; si no hay, por similitud de título + marca + modelo, con un LLM como desempate). Cada grupo muestra el precio en cada tienda, ordenado de menor a mayor.
3. **Confirmar qué seguir.** Elijo el producto y marco/desmarco tiendas. Nada se sigue sin mi confirmación.
4. **Seguimiento periódico.** Revisión cada X horas (configurable, por defecto 6h; más seguido en fechas como CyberDay o Black Friday).
5. **Historial de precio** con gráfico por tienda (7d / 30d / 90d / todo) y marcador del mínimo histórico.
6. **Alertas** cuando:
   - baja de un precio objetivo que yo defino,
   - baja X% respecto al último precio,
   - llega a su mínimo histórico,
   - vuelve a tener stock.
7. **Dashboard** con mis productos seguidos: precio actual más bajo, tienda, variación, mini gráfico (sparkline) y estado.
8. **Pegar un link directo** de cualquier tienda soportada para seguir ese producto sin buscar.

### Funciones que le dan valor real (fase 2)

9. **Detector de descuento falso.** Compara el precio "antes" que muestra la tienda con la mediana real de los últimos 60–90 días. Si el "antes" se infló hace poco, mostrar una advertencia clara ("este descuento no es real: el precio habitual era $X").
10. **Indicador "¿compro ahora o espero?"** Simple y explicable: precio actual vs. mínimo, mediana y tendencia, más cercanía a eventos (CyberDay, Black Friday, Cyber Monday). Nada de predicciones mágicas, solo reglas claras.
11. **Calendario de eventos de descuento en Chile** editable desde un panel admin, que sube la frecuencia de revisión esos días.
12. **Precio total real:** opción de ingresar mi comuna para estimar despacho cuando la tienda lo exponga sin login, o al menos marcar "despacho gratis" / "retiro en tienda".
13. **Filtro de confianza del vendedor:** en marketplaces, distinguir tienda oficial / vendido por la tienda / vendedor tercero, con opción de excluir terceros.
14. **Listas / colecciones** (ej: "Navidad", "Setup escritorio") con presupuesto total y aviso cuando la lista completa queda bajo el presupuesto.
15. **Alternativas equivalentes:** sugerir modelos parecidos más baratos (ej: misma capacidad, otra marca) — siempre como sugerencia, nunca reemplazando lo que elegí.
16. **Resumen semanal** por email: qué bajó, qué subió, qué conviene comprar.

### Extensión de navegador (fase temprana, ver "Tiendas que bloquean bots")

17. **Extensión de navegador** (Chrome, Manifest V3): en la página de un producto, botón "Seguir precio", un mini gráfico del historial y envío automático del precio visible al backend (solo en tiendas soportadas y solo en páginas de producto que yo abro). Esto es lo más parecido a Distill.

### Fase 3 (opcional)

18. **Web push** y PWA instalable.
19. **Compartir** un producto seguido con link público de solo lectura.
20. **Exportar** historial a CSV.

## Pantallas

- **Home / búsqueda:** un input grande protagonista ("¿Qué quieres comprar?") con ejemplos clickeables.
- **Resultados:** tarjetas por producto agrupado, con tabla de tiendas y precios, badges (precio con tarjeta, sin stock, vendedor tercero, descuento dudoso).
- **Detalle de producto:** gráfico de historial, tabla por tienda, configuración de alerta, indicador "comprar/esperar".
- **Mis seguimientos (dashboard).**
- **Alertas / notificaciones.**
- **Configuración:** canales de aviso, frecuencia, comuna, tiendas activas.
- **Estado de tiendas (admin):** qué adaptadores funcionan y cuáles fallaron.

Estados vacíos, de carga (skeletons) y de error bien diseñados en todas. Accesibilidad AA (contraste, foco visible, labels, navegación con teclado).

## Fases de entrega

1. **Fase 0:** monorepo, Docker Compose local (web + worker + Postgres), Supabase, auth, CI, layout base y sistema de diseño (tokens + componentes shadcn). Deploy de la web a Vercel Hobby desde el día 1. Todo en planes gratis.
2. **Fase 1:** sondeo de tiendas (reporte de qué expone y qué bloquea cada una desde GitHub Actions) + 2 adaptadores por servidor: **Mercado Libre (API oficial)** y **Paris**, con tests con fixtures guardadas (HTML/JSON de ejemplo) para que no dependan de la red.
3. **Fase 2:** seguir productos + worker `worker:once` corriendo con cron en GitHub Actions + historial + gráfico + healthcheck.
4. **Fase 3:** extensión de navegador (seguir producto, captura de precio y de resultados de búsqueda) para **Falabella, Ripley y Lider**, más ingreso manual.
5. **Fase 4:** alertas por Telegram y email + detección de bloqueo y backoff.
6. **Fase 5:** búsqueda unificada (servidor + links/extensión) y agrupación de productos; IA opcional encima.
7. **Fase 6:** resto de tiendas de la tabla y panel de estado.
8. **Fase 7:** funciones de valor (descuento falso, comprar/esperar, eventos, listas).

## Criterios de aceptación generales

- Cada adaptador tiene tests con fixtures y un script `npm run check:store falabella "<url>"` para probarlo a mano.
- Ningún job revisa la misma tienda más de N veces por minuto.
- Los precios se guardan como enteros en CLP (sin decimales).
- Las alertas no se repiten para el mismo evento.
- Variables sensibles en `.env` con un `.env.example` documentado.
- README con cómo levantarlo local, cómo agregar una tienda nueva y cómo desplegar.

## Lo que no quiero

- Scraping de páginas con login.
- Saltarse captchas, protecciones anti-bot o bloqueos (ni solvers, ni proxies rotativos, ni navegadores "stealth").
- Comprar automáticamente: la app solo avisa, la compra la hago yo.
- Que siga productos sin que yo los confirme.
