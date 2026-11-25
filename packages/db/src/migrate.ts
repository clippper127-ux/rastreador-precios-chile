import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

// Para migrar usa la conexión directa (5432) o el "session pooler", no el de transacciones (6543).
const url = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
const db = createDb(url, { max: 1 });

await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
console.log("Migraciones aplicadas.");
await db.$client.end();
