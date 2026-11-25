import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

/** Chequeo rápido del estado de la base: RLS por tabla, trigger de perfiles y tiendas activas. */
const db = createDb(undefined, { max: 1 });
const rls = await db.execute<{ tablename: string; rowsecurity: boolean }>(
  sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`,
);
const trigger = await db.execute<{ n: number }>(
  sql`select count(*)::int as n from pg_trigger where tgname = 'on_auth_user_created'`,
);
const stores = await db.execute<{ enabled: boolean; n: number }>(
  sql`select enabled, count(*)::int as n from stores group by enabled`,
);
console.table(rls.map((r) => ({ tabla: r.tablename, rls: r.rowsecurity })));
console.log("Trigger de perfiles:", trigger[0]?.n === 1 ? "OK" : "FALTA");
console.log("Tiendas:", stores.map((s) => `${s.enabled ? "activas" : "desactivadas"}=${s.n}`).join(", "));
await db.$client.end();
