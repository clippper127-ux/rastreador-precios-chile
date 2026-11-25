import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Conexión directa (rol `postgres`): se salta RLS. Úsala solo en el servidor y filtra
 * siempre por usuario con `forUser()`. Nunca la expongas al navegador.
 *
 * En Vercel usa la URL del "transaction pooler" de Supabase (puerto 6543): por eso `prepare: false`.
 */
export function createDb(url = process.env.DATABASE_URL, opts: { max?: number } = {}) {
  if (!url) throw new Error("Falta DATABASE_URL. Revisa .env (ver .env.example).");
  const client = postgres(url, { prepare: false, max: opts.max ?? 5 });
  return drizzle(client, { schema });
}

let cached: Database | undefined;

/** Instancia compartida por proceso (evita abrir conexiones nuevas en cada request en dev). */
export function getDb(): Database {
  cached ??= createDb();
  return cached;
}
