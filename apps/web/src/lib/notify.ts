import "server-only";
import { deliverPendingAlerts, type DeliveryConfig } from "@rastreador/db/alerts";
import { after } from "next/server";
import { db } from "./db";

export function deliveryConfig(): DeliveryConfig {
  return {
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    resendApiKey: process.env.RESEND_API_KEY || undefined,
    resendFrom: process.env.RESEND_FROM || undefined,
  };
}

/** Envía las alertas pendientes después de responder (no hace esperar al usuario ni a la extensión). */
export function deliverSoon() {
  after(async () => {
    try {
      await deliverPendingAlerts(db(), deliveryConfig());
    } catch (err) {
      console.warn("No se pudieron enviar alertas ahora; el worker reintentará:", (err as Error).message);
    }
  });
}
