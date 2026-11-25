import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

/** Marca a un usuario (por correo) como administrador: puede pausar tiendas y reintentar bloqueos en /estado.
 *   pnpm db:admin tu@correo.cl
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Uso: pnpm db:admin <correo>");
  process.exit(1);
}
const db = createDb(undefined, { max: 1 });
const rows = await db.execute<{ id: string }>(sql`
  update profiles set is_admin = true
  where id = (select id from auth.users where lower(email) = ${email})
  returning id`);
console.log(rows.length ? "Listo: ahora eres administrador." : "No encontré un usuario con ese correo (¿ya entraste a la app al menos una vez?).");
await db.$client.end();
