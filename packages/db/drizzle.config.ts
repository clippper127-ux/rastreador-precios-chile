import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  // Solo manejamos el esquema "public". "auth" es de Supabase.
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
