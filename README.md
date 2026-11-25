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

## Extensión de navegador (Falabella, Paris, Ripley, Lider)

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
