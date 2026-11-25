import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import "./env";
import { readerClient } from "./telegram-reader";

/*
 * Inicia sesión UNA vez con la cuenta de Telegram dedicada y guarda la sesión en .env (TG_SESSION).
 *   pnpm telegram:login
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
  console.log("Inicia sesión con la cuenta DEDICADA (no la personal).\n");
  const client = readerClient({ apiId, apiHash });
  await client.start({
    phoneNumber: () => ask("Número de la cuenta dedicada (con +56): "),
    phoneCode: () => ask("Código que te llegó por Telegram: "),
    password: () => ask("Contraseña de verificación en dos pasos (Enter si no tiene): ", true),
    onError: (err) => console.error("Telegram:", err.message),
  });
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
