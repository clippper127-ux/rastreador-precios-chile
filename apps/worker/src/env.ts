import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

export const env = {
  databaseUrl: process.env.DATABASE_URL,
  healthcheckUrl: process.env.HEALTHCHECK_URL,
  runner: (process.env.GITHUB_ACTIONS === "true" ? "gha" : "local") as "gha" | "local",
  /** User-Agent honesto: dice quién eres y para qué. */
  userAgent: process.env.WORKER_USER_AGENT ?? "RastreadorPreciosPersonal/0.1 (uso personal; seguimiento de precios)",
};
