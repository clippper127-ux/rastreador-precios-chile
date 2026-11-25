import { env } from "./env";

/** Ping a Healthchecks.io. Nunca hace fallar la pasada si el ping falla. */
export async function ping(kind: "start" | "success" | "fail", body?: string): Promise<void> {
  if (!env.healthcheckUrl) return;
  const suffix = kind === "success" ? "" : `/${kind}`;
  try {
    await fetch(`${env.healthcheckUrl}${suffix}`, {
      method: body ? "POST" : "GET",
      body: body?.slice(0, 10_000),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn("No se pudo hacer ping a Healthchecks:", (err as Error).message);
  }
}
