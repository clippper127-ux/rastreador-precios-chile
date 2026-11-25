import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

export const env = {
  databaseUrl: process.env.DATABASE_URL,
  healthcheckUrl: process.env.HEALTHCHECK_URL,
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
  resendApiKey: process.env.RESEND_API_KEY || undefined,
  resendFrom: process.env.RESEND_FROM || undefined,
  runner: (process.env.GITHUB_ACTIONS === "true" ? "gha" : "local") as "gha" | "local",
  /** User-Agent honesto: dice quién eres y para qué. */
  userAgent: process.env.WORKER_USER_AGENT ?? "RastreadorPreciosPersonal/0.1 (uso personal; seguimiento de precios)",
};
