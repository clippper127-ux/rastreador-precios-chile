import { getSettings, type IngestResponse, type Msg } from "./shared";

/*
 * Service worker: único lugar que habla con la app (el content script no tiene el token).
 * Solo envía lo que el content script capturó de una ficha de producto de una tienda soportada.
 */

async function call(path: string, init: RequestInit): Promise<IngestResponse> {
  const { apiUrl, token } = await getSettings();
  if (!token) return { error: "sin_configurar" };
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
    });
    const body = (await res.json().catch(() => ({}))) as IngestResponse;
    return { ...body, status: res.status, appUrl: apiUrl, ...(res.ok ? {} : { error: body.error ?? `http_${res.status}` }) };
  } catch {
    return { error: "sin_conexion", appUrl: apiUrl };
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, _sender, reply) => {
  if (msg.type === "capture") {
    call("/api/ingest", { method: "POST", body: JSON.stringify({ capture: msg.capture, follow: msg.follow }) }).then(reply);
    return true; // respuesta asíncrona
  }
  if (msg.type === "ping") {
    call("/api/ingest", { method: "GET" }).then(reply);
    return true;
  }
  return false;
});
