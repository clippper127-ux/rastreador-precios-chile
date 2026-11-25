import { DEFAULT_API, getSettings, type IngestResponse, type Msg } from "./shared";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const apiInput = $<HTMLInputElement>("apiUrl");
const tokenInput = $<HTMLInputElement>("token");
const status = $<HTMLParagraphElement>("status");
const save = $<HTMLButtonElement>("save");

function show(text: string, kind: "ok" | "err" | "" = "") {
  status.textContent = text;
  status.className = kind;
}

async function test() {
  const r = (await chrome.runtime.sendMessage({ type: "ping" } satisfies Msg)) as IngestResponse;
  if (!r.error) show("✓ Conectada a la app", "ok");
  else if (r.error === "token_invalido") show("El token no es válido. Genera uno nuevo en Ajustes.", "err");
  else if (r.error === "sin_conexion") show("No pudimos conectar. Revisa la dirección y que la app esté abierta.", "err");
  else if (r.error === "sin_configurar") show("");
  else show(`No funcionó (${r.error}).`, "err");
}

const s = await getSettings();
apiInput.value = s.apiUrl || DEFAULT_API;
tokenInput.value = s.token;
if (s.token) void test();

$<HTMLFormElement>("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  save.disabled = true;
  show("Probando…");
  try {
    const url = new URL(apiInput.value.trim());
    const origin = url.origin;
    // Para una app desplegada (https) hay que pedir permiso a ese dominio; localhost ya está permitido.
    if (url.hostname !== "localhost") {
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) {
        show("Sin permiso para conectar con esa dirección.", "err");
        return;
      }
    }
    await chrome.storage.local.set({ apiUrl: origin, token: tokenInput.value.trim() });
    await test();
  } catch {
    show("La dirección no es válida.", "err");
  } finally {
    save.disabled = false;
  }
});

// "Elegir el precio en esta página": le pide al content script de la pestaña activa que entre en modo selección.
const pickBox = $<HTMLElement>("pickBox");
const pickMsg = $<HTMLParagraphElement>("pickMsg");
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let pickable = false;
if (tab?.id != null) {
  try {
    const r = (await chrome.tabs.sendMessage(tab.id, { type: "canPick" })) as { ok?: boolean } | undefined;
    pickable = !!r?.ok;
  } catch {
    pickable = false;
  }
}
if (pickable) pickBox.hidden = false;
else {
  pickMsg.hidden = false;
  pickMsg.textContent = "Abre la ficha de un producto de una tienda soportada para elegir su precio. Si ya la tenías abierta, recarga la página.";
}
$<HTMLButtonElement>("pick").addEventListener("click", async () => {
  if (tab?.id == null) return;
  await chrome.tabs.sendMessage(tab.id, { type: "startPick" });
  window.close();
});
