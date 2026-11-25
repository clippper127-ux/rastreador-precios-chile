import "server-only";
import { getDb } from "@rastreador/db";

/**
 * Conexión directa (se salta RLS). Regla: toda consulta de datos personales pasa por las funciones
 * de `lib/watches.ts`, que siempre filtran por el userId de la sesión validada.
 */
export const db = () => getDb();
