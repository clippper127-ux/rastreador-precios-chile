import "server-only";

// La lógica vive en @rastreador/db para compartirla con el worker y el bot de Telegram.
export { ensureTracked, recordCapture, takeRateLimit, userFollowsListing, type ListingRef } from "@rastreador/db/track";
