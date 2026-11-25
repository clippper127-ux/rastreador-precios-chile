import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import "./env";
import qrcode from "qrcode-terminal";
import { readerClient } from "./telegram-reader";

/*
 * Inicia sesión UNA vez con la cuenta de Telegram dedicada y guarda la sesión en .env (TG_SESSION).
 *   pnpm telegram:login            (escaneando un QR con la app de Telegram)
 *   pnpm telegram:login --codigo   (con número y código)
 * Tú escribes el número, el código y la contraseña en esta terminal; no se muestran ni se guardan en otro lado.
 * Requiere TG_API_ID y TG_API_HASH en .env (de https://my.telegram.org → API development tools).
 */

const ENV_PATH = fileURLToPath(new URL("../../../.env", import.meta.url));

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Oculta lo que escribes (contraseña).
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(a.trim());
    }),
  );
}

function saveSession(session: string) {
  const lines = readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s*TG_SESSION\s*=/.test(l));
  if (i >= 0) lines[i] = `TG_SESSION=${session}`;
  else lines.push(`TG_SESSION=${session}`);
  writeFileSync(ENV_PATH, lines.join("\n"));
}

async function main() {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH?.trim();
  if (!apiId || !apiHash) {
    console.error("Falta TG_API_ID o TG_API_HASH en .env (sácalos en https://my.telegram.org → API development tools).");
    process.exitCode = 1;
    return;
  }
  const client = readerClient({ apiId, apiHash });
  const password = (hint?: string) => ask(`Contraseña de verificación en dos pasos${hint ? ` (pista: ${hint})` : ""} (Enter si no tiene): `, true);
  if (process.argv.includes("--codigo")) {
    console.log("Inicia sesión con la cuenta DEDICADA (no la personal).\n");
    await client.start({
      phoneNumber: async () => {
        // Acepta "9XXXXXXXX", "569XXXXXXXX" o "+569XXXXXXXX" (celular chileno).
        const raw = (await ask("Número de la cuenta dedicada (ej.: +56912345678): ")).replace(/[\s()-]/g, "");
        return /^9\d{8}$/.test(raw) ? `+56${raw}` : /^56\d{9}$/.test(raw) ? `+${raw}` : raw;
      },
      phoneCode: () => ask("Código que te llegó por Telegram: "),
      password,
      onError: (err) => console.error("Telegram:", err.message),
    });
  } else {
    // Por defecto: QR (como Telegram Desktop). No depende de que llegue un código.
    await client.connect();
    await client.signInUserWithQrCode(
      { apiId, apiHash },
      {
        qrCode: async ({ token }) => {
          console.clear();
          console.log("Con la cuenta DEDICADA en tu celular: Telegram → Ajustes → Dispositivos → Vincular dispositivo de escritorio,");
          console.log("y escanea este QR (se renueva cada ~30 s):\n");
          qrcode.generate(`tg://login?token=${token.toString("base64url")}`, { small: true });
        },
        password,
        onError: async (err) => {
          console.error("Telegram:", err.message);
          return false;
        },
      },
    );
  }
  const me = await client.getMe();
  saveSession(String(client.session.save()));
  await client.disconnect();
  await client.destroy().catch(() => {});
  console.log(`\n✅ Sesión guardada en .env (TG_SESSION) para la cuenta ${"firstName" in me ? me.firstName : ""}.`);
  console.log("No compartas esa línea: da acceso a esa cuenta de Telegram.");
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
