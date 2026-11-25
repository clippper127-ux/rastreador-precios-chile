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
  `Respaldo semanal` guarda un `pg_dump` como artifact por 30 días.
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

## Radar de ofertas (Telegram)

Lee canales y grupos de Telegram y te avisa (por el bot o correo) cuando aparece:
un link o una mención de algo que sigues, una de tus **palabras clave**, o un posible **error de precio**.
Cada mensaje muestra las tiendas detectadas con un botón **Seguir precio** (nada se sigue sin tu clic).

- **Canales públicos:** en **Radar** pega `@canal` o `t.me/canal`. Se leen desde su vista web pública
  (`t.me/s/canal`), sin cuenta. Solo se avisan mensajes posteriores a tu suscripción.
- **Grupos:** vincula Telegram, en @BotFather haz `/setprivacy` → tu bot → **Disable**, agrega el bot
  al grupo y escribe `/radar` (y `/radar_off` para desactivarlo). Solo grupos que permiten bots.
- **Frecuencia:** el workflow `Radar` corre cada hora (`pnpm radar:once`, liviano). En tu PC puedes
  correrlo más seguido. Prueba de punta a punta: `pnpm --filter @rastreador/db exec tsx src/smoke-radar.ts`.

## Extensión de navegador (Falabella, Sodimac, Tottus, Paris, Ripley, Lider, PC Factory)

Estas tiendas bloquean al servidor, así que el precio llega desde tu navegador cuando abres la ficha.
La extensión solo lee fichas de producto de esas tiendas, no hace requests propias a ellas y solo guarda
precios de productos que alguien sigue.

1. Compílala: `pnpm --filter @rastreador/extension build` (queda en `apps/extension/dist`).
2. En Chrome abre `chrome://extensions`, activa **Modo de desarrollador** → **Cargar descomprimida** → elige `apps/extension/dist`.
3. En la app: **Ajustes → Extensión de navegador → Conectar extensión** y copia el token.
4. Haz clic en el ícono de la extensión, pega el token (y la dirección de la app, por defecto `http://localhost:3000`) → **Guardar y probar**.
5. Abre una ficha de producto: aparece un panel abajo a la derecha con el precio leído y el botón **Seguir precio**.
   Si ya la sigues, el precio se guarda solo en cada visita.

Desarrollo: `pnpm --filter @rastreador/extension watch` y recarga la extensión en `chrome://extensions`.
En la consola de una ficha, `__rastreadorCapture()` muestra lo que la extensión leyó.
Prueba de la API de punta a punta (usuario temporal, solo base de desarrollo): `pnpm --filter @rastreador/db exec tsx src/smoke-ingest.ts`.

Si nada funciona, cada ficha seguida tiene **Ingresar precio a mano** en la app.
