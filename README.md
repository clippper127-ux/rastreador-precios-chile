# Rastreador de precios Chile

Sigue precios en tiendas chilenas y te avisa cuando conviene comprar. Uso personal, 100 % en planes gratis.

- Especificación: [SPEC.md](SPEC.md)
- Arquitectura y modelo de datos: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)

## Estructura

```
apps/web        Next.js (App Router): UI, auth, API para la extensión → Vercel Hobby
apps/worker     Pasadas de scraping y alertas (`worker:once`) → GitHub Actions cron o tu PC
apps/extension  Extensión Chrome MV3 (Fase 3)
packages/core   Tipos, interfaz de adaptadores, lógica de precios (sin dependencias de Next ni DB)
packages/db     Esquema Drizzle, migraciones SQL (incluye RLS), seed de tiendas
```

## Levantarlo en local

Requisitos: Node 22 o superior y pnpm 10 (`npm install -g pnpm`).

```powershell
pnpm install
pnpm dev            # http://localhost:3000
```

Sin variables de Supabase la app abre igual (sin login), útil para trabajar el diseño. `/sistema` muestra los tokens y componentes.

### Conectar Supabase

1. Crea un proyecto en supabase.com (plan Free). Recomendado: uno para desarrollo y otro para producción.
2. Copia `.env.example` a `.env` en la raíz y completa las claves (web, worker y db leen el mismo archivo).
3. Aplica migraciones y carga las tiendas:
   ```powershell
   pnpm db:migrate
   pnpm db:seed
   ```
4. En Supabase → Authentication → URL Configuration, agrega `http://localhost:3000/auth/callback` (y la URL de Vercel) a *Redirect URLs*.
5. Para entrar con Google: Authentication → Providers → Google (requiere un cliente OAuth gratis en Google Cloud).

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Web en modo desarrollo |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Lo mismo que corre CI |
| `pnpm db:generate` | Genera una migración desde `packages/db/src/schema.ts` |
| `pnpm db:migrate` | Aplica migraciones |
| `pnpm db:seed` | Carga/actualiza la tabla de tiendas |
| `pnpm worker:once` | Una pasada del worker |
| `pnpm check:store <tienda> "<url>" [--save nombre]` | Prueba un adaptador a mano, sin tocar la DB; `--save` guarda un fixture recortado |
| `pnpm --filter @rastreador/worker probe [tienda...]` | Sondea tiendas (robots, búsqueda, ficha) y genera `docs/sondeo-tiendas.md` |
| `pnpm db:verify` | Revisa RLS, trigger de perfiles y tiendas activas |
| `pnpm db:admin <correo>` | Te marca como administrador (pausar tiendas y reintentar bloqueos en **/estado**) |
| `powershell -ExecutionPolicy Bypass -File scripts\entrar-sin-correo.ps1` | Solo dev: inicia sesión sin enviar correo (pide la secret key una vez) |

## Agregar una tienda

1. Un adaptador en `apps/worker/src/adapters/<tienda>.ts` que implemente `StoreAdapter` (`packages/core/src/adapter.ts`).
2. Registrarlo en `apps/worker/src/adapters.ts`.
3. Una fila en `packages/db/src/seed.ts` (fuentes en orden, frecuencia, límite por minuto) y `pnpm db:seed`.
4. Fixtures (HTML/JSON reales guardados) y tests que no dependan de la red.

Reglas: respetar `robots.txt`, User-Agent honesto, nada con login, preferir datos estructurados, y nunca saltarse captchas ni protecciones anti-bot.

## Desplegar

- **Web → Vercel Hobby:** importa el repo, *Root Directory* `apps/web`, y agrega las variables de `.env.example` que empiezan con `NEXT_PUBLIC_` más `DATABASE_URL`.
- **Worker → GitHub Actions** (repo **privado**): en *Settings → Secrets and variables → Actions* crea los secrets
  `DATABASE_URL` (transaction pooler), `DATABASE_URL_MIGRATIONS` (session pooler, para el respaldo) y,
  si usas Healthchecks.io, `HEALTHCHECK_URL`. El workflow `Worker` corre cada 4 h y se puede lanzar a mano;
  `Respaldo semanal` guarda un `pg_dump` **cifrado** (`BACKUP_PASSPHRASE`, AES-256) como artifact por 30 días.
  Restaurar: `gpg --decrypt rastreador-FECHA.dump.gpg > rastreador.dump` y luego `pg_restore`.
  Para probarlo en tu PC: `pnpm worker:once`. Para una prueba completa sin datos de usuarios: `pnpm --filter @rastreador/worker smoke`.
- **Extensión:** ver abajo.

## Búsqueda unificada

Escribe lo que buscas en el inicio. La app:
- busca en el servidor donde se permite (**Hites, Jumbo, Santa Isabel**; caché de 30 min, máx. 6 búsquedas/min por tienda);
- muestra botones **Buscar en Falabella / Paris / Ripley / Lider / La Polar / Abcdin**: con la extensión,
  los resultados que ves en esas tiendas se suman solos a la comparación (la página se actualiza sola);
- agrupa el mismo producto entre tiendas (por EAN o marca + modelo + título, sin IA) y ordena por precio;
- con **Seguir** eliges qué tiendas vigilar: queda un solo producto con todas ellas.

Si abres la búsqueda de una tienda por tu cuenta, el panel de la extensión ofrece **Enviar resultados a Rastreador**.
Prueba de la API: `pnpm --filter @rastreador/db exec tsx src/smoke-search.ts`.

> **Antivirus con inspección HTTPS (Avast, etc.):** el servidor de desarrollo arranca con `--use-system-ca`
> para confiar en los certificados de Windows. Sin eso, las búsquedas fallan con "unable to verify the first certificate".

## SoloTodo (precios de tiendas que bloquean)

La búsqueda y el worker usan la **API pública de SoloTodo** (`publicapi.solotodo.com`, sin clave) para traer precios
de **Falabella, Paris, Ripley, Lider, PC Factory, Sodimac y Tottus** sin la extensión:
- en **/buscar**, sus resultados se suman a la comparación (marcados "vía SoloTodo") y se agrupan por su producto,
  sin mezclar versiones;
- al seguirlos, el worker actualiza su precio cada ~3 h (máx. 60 por pasada, con pausa entre requests);
- si pegaste un link de esas tiendas, el worker intenta encontrarlo en SoloTodo una vez por semana.
- **historial previo**: al enlazar una publicación se importa su historial del último año desde SoloTodo
  (solo los cambios, antes de nuestro primer precio y sin generar avisos), así el gráfico, el mínimo histórico
  y "¿compro o espero?" funcionan desde el primer día.

El precio "oferta" de SoloTodo es con el medio de pago preferente de la tienda (Tarjeta CMR, Ripley, Cencosud…),
por eso se guarda como precio con tarjeta. Uso moderado (caché de 30 min, 10 búsquedas/min).
No pude leer sus términos de uso (la página requiere JavaScript): si SoloTodo pide dejar de usarla, se desactiva
quitando la llamada en `apps/web/src/lib/search.ts` y `apps/worker/src/once.ts`.
Prueba: `pnpm --filter @rastreador/db exec tsx --use-system-ca src/smoke-solotodo.ts`.

## Alertas (Telegram y correo)

Se avisa cuando un producto que sigues baja de tu precio objetivo, baja más de X %, llega a su mínimo
histórico o vuelve a tener stock. Cada evento se avisa una vez; si hay varios motivos a la vez van en un
solo mensaje. Se configuran por producto (detalle → **Alertas**) y quedan todas en la página **Alertas**.

**Telegram (recomendado, gratis):**
1. En Telegram habla con **@BotFather** → `/newbot` → elige nombre y usuario (termina en `bot`).
2. Copia el token que te da y ponlo en `.env` como `TELEGRAM_BOT_TOKEN` (y como secret en GitHub Actions).
3. Reinicia la app → **Ajustes → Canales de aviso → Vincular Telegram** → abre el bot, toca **Iniciar** → **Ya toqué Iniciar**.

El bot no usa webhook: lee sus mensajes en cada pasada del worker y cuando pulsas "Ya toqué Iniciar".

**Grupos de ofertas:** reenvíale al bot cualquier mensaje de un grupo (o pega un link). Si trae links de
tiendas soportadas —también acortados o de afiliados— los sigue por ti y te responde con el link al historial.

**Correo (Resend, gratis 100/día):** crea una cuenta en resend.com, genera una API key y ponla en
`RESEND_API_KEY`. Sin dominio propio solo puede enviar al correo de tu cuenta de Resend.

Pruebas sin enviar nada real: `pnpm --filter @rastreador/db exec tsx src/smoke-alerts.ts`.

## Buscar con una foto

En el inicio, **Buscar con una foto** (en el celular abre la cámara):
1. Si la foto muestra el **código de barras**, se lee **en tu dispositivo** (sin subir la foto) y se busca por EAN:
   primero entre lo que ya sigue alguien en la app y, si no, en **Open Food Facts** (base abierta, fuerte en
   supermercado) para obtener el nombre del producto.
2. Si no hay código de barras y configuraste `LLM_API_KEY` (Gemini, plan gratis en aistudio.google.com),
   la foto reducida se envía a Gemini para reconocer el producto. Máx. 10 fotos por hora.
   El modelo se cambia con `LLM_MODEL`; los nombres y límites gratis cambian, confírmalos en AI Studio.

## ¿Compro ahora o espero? · descuentos falsos · eventos · listas

- **Veredicto** en cada producto (y en el dashboard): *Buen momento / Buen precio / Promedio / Algo caro /
  Mejor espera / Faltan datos*, con sus razones. Reglas simples: mínimo histórico, percentiles de 90 días,
  otra tienda más barata y cercanía a un evento (≤ 21 días). Requiere 14 días de historial.
- **Descuento falso**: si el "antes" está ≥ 10 % sobre lo que realmente costó en 90 días, se avisa
  ("este descuento no es real: el precio habitual era $X").
- **Eventos** (CyberDay, Black Friday…): se editan en **/estado** (administradores). Durante un evento el
  worker revisa cada 2 h. Las fechas iniciales son aproximadas: confírmalas cuando se anuncien.
- **Listas** con presupuesto (**/listas**): agrega productos desde su detalle; te avisamos una vez cuando
  la lista completa quede bajo el presupuesto. Prueba: `pnpm --filter @rastreador/db exec tsx src/smoke-lists.ts`.

## Radar de ofertas (Telegram)

Lee canales y grupos de Telegram y te avisa (por el bot o correo) cuando aparece:
un link o una mención de algo que sigues, una de tus **palabras clave**, o un posible **error de precio**.
Cada mensaje muestra las tiendas detectadas con un botón **Seguir precio** (nada se sigue sin tu clic).

- **Canales públicos:** en **Radar** pega `@canal` o `t.me/canal`. Se leen desde su vista web pública
  (`t.me/s/canal`), sin cuenta. Solo se avisan mensajes posteriores a tu suscripción.
- **Grupos:** vincula Telegram, en @BotFather haz `/setprivacy` → tu bot → **Disable**, agrega el bot
  al grupo y escribe `/radar` (y `/radar_off` para desactivarlo). Solo grupos que permiten bots.
- **Grupos que no aceptan bots:** se leen con una **cuenta de Telegram dedicada** (no la personal):
  1. Con esa cuenta entra a https://my.telegram.org → **API development tools** y crea una app (gratis).
     Copia `api_id` y `api_hash` a `.env` como `TG_API_ID` y `TG_API_HASH`.
  2. `pnpm telegram:login`: escribes el número, el código y la contraseña en la terminal; guarda `TG_SESSION` en `.env`.
  3. `powershell -ExecutionPolicy Bypass -File scripts\github-secrets.ps1` para subir las tres a GitHub.
  4. Une esa cuenta a los grupos. Cada hora se leen **todos** sus grupos y canales; los nuevos se suscriben
     a quienes tienen Telegram vinculado (sus mensajes anteriores no se avisan). Solo lee: no escribe ni marca leído.
- **Ofertas destacadas** (Radar → Qué avisarte): avisa ofertas muy buenas aunque no las sigas. Suma puntaje por
  descuento alto (90 %+ se trata como posible error de precio), baja de precio en el mensaje, palabras como
  "regalado" o "corran" (más las tuyas), reacciones y respuestas, varias personas hablando del mismo producto en un chat
  (±3 h) y precio bajo el mínimo histórico conocido. Sensibilidad Pocas/Normal/Muchas con tope de 5/10/20 avisos al día,
  máx. 2 por grupo cada 6 h, y la misma oferta en varios grupos llega una vez.
- **Filtros por categoría** (Radar → Qué avisarte): "Nunca avisarme de" (p. ej. Ropa interior), "Avisarme solo de"
  y palabras bloqueadas. Se aplican a destacadas y errores de precio; lo que sigues y tus palabras a vigilar llegan igual.
  Las categorías se detectan por palabras del mensaje (`packages/core/src/radar/categories.ts`).
- **Frecuencia:** el workflow `Radar` corre cada 10 min (repo público) (`pnpm radar:once`). Si tu PC está prendido, el
  **radar del PC** pregunta cada minuto por mensajes nuevos y avisa al tiro; mientras está activo (latido en
  `/api/health` → `radarLive`), GitHub se salta sus pasadas para no gastar minutos.
  - **Despertador:** GitHub atrasa (o se salta) los cron, así que Supabase lanza el workflow cada 10 min con
    `pg_cron` + `pg_net` (job `radar-despertador`). Usa un token *fine-grained* de GitHub solo con **Actions: Read and
    write** sobre este repo, guardado cifrado en Supabase Vault (`gh_dispatch_token`); en `.env` va como
    `GH_DISPATCH_TOKEN` solo para cargarlo. Si el token vence: regenerarlo en GitHub, pegarlo en `.env` y volver a
    guardarlo en Vault (`vault.update_secret`).
  - Usa su propia sesión: `pnpm telegram:login --live` (guarda `TG_SESSION_LIVE`, que NO se sube a GitHub).
  - Arranque automático: acceso directo a `scripts
adar-live-start.vbs` en la carpeta Inicio (Win+R → `shell:startup`).
    Corre oculto, se reinicia solo si se cae y deja registro en `%LOCALAPPDATA%\Rastreador
adar-live.log`.
  - Telegram no "empuja" los mensajes de grupos grandes a esta cuenta, por eso pregunta cada 60 s en vez de escuchar. Prueba de punta a punta: `pnpm --filter @rastreador/db exec tsx src/smoke-radar.ts`.

## Extensión de navegador (Falabella, Sodimac, Tottus, Paris, Ripley, Lider, PC Factory)

Estas tiendas bloquean al servidor, así que el precio llega desde tu navegador cuando abres la ficha.
La extensión solo lee fichas de producto de esas tiendas, no hace requests propias a ellas y solo guarda
precios de productos que alguien sigue.

1. Compílala: `pnpm --filter @rastreador/extension build` (queda en `apps/extension/dist`).
2. En Chrome abre `chrome://extensions`, activa **Modo de desarrollador** → **Cargar descomprimida** → elige `apps/extension/dist`.
3. En la app: **Ajustes → Extensión de navegador → Conectar extensión** y copia el token.
4. Haz clic en el ícono de la extensión, pega el token (la dirección de la app ya viene puesta: `https://rastreador-precios-chile.vercel.app`; para desarrollo usa `http://localhost:3000`) → **Guardar y probar**.
5. Abre una ficha de producto: aparece un panel abajo a la derecha con el precio leído y el botón **Seguir precio**.
   Si ya la sigues, el precio se guarda solo en cada visita.

Desarrollo: `pnpm --filter @rastreador/extension watch` y recarga la extensión en `chrome://extensions`.
En la consola de una ficha, `__rastreadorCapture()` muestra lo que la extensión leyó.
Prueba de la API de punta a punta (usuario temporal, solo base de desarrollo): `pnpm --filter @rastreador/db exec tsx src/smoke-ingest.ts`.

Si nada funciona, cada ficha seguida tiene **Ingresar precio a mano** en la app.
