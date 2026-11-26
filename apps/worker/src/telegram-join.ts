import { readFileSync } from "node:fs";
import { Api } from "telegram";
import "./env";
import { readerClient, readerConfig } from "./telegram-reader";

/*
 * Une la cuenta de Telegram DEDICADA a grupos y canales a partir de sus links.
 *   pnpm --filter @rastreador/worker exec tsx --use-system-ca src/telegram-join.ts links.txt
 * Acepta t.me/+CODIGO, t.me/joinchat/CODIGO (privados) y t.me/nombre o @nombre (públicos).
 * Pausa entre grupos para no parecer spam; si Telegram pide esperar, espera.
 */

type Target = { kind: "invite"; hash: string } | { kind: "public"; username: string };

export function parseJoinLink(raw: string): Target | undefined {
  const s = raw.trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
  let m = s.match(/^(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([\w-]+)/i);
  if (m) return { kind: "invite", hash: m[1]! };
  m = s.match(/^(?:t\.me|telegram\.me)\/(?:s\/)?([a-z][\w]{3,})\/?(?:\d+)?$/i) ?? s.match(/^@([a-z][\w]{3,})$/i);
  if (m) return { kind: "public", username: m[1]! };
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = readerConfig();
  if (!cfg) throw new Error("Falta TG_API_ID, TG_API_HASH o TG_SESSION en .env");
  const file = process.argv[2];
  if (!file) throw new Error("Uso: telegram-join.ts <archivo con links>");
  const text = readFileSync(file, "utf8");
  const raws = [...new Set(text.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/\S+|@[a-z]\w{3,}/gi) ?? [])];
  const client = readerClient(cfg);
  await client.connect();
  const result: Record<string, number> = { unido: 0, ya_estaba: 0, solicitud_enviada: 0, error: 0 };
  try {
    for (const [i, raw] of raws.entries()) {
      const t = parseJoinLink(raw);
      const label = `${i + 1}/${raws.length}`;
      if (!t) {
        console.log(`${label} ✗ link no reconocido`);
        result.error!++;
        continue;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          let title = "";
          if (t.kind === "invite") {
            const upd = await client.invoke(new Api.messages.ImportChatInvite({ hash: t.hash }));
            const chat = "chats" in upd ? upd.chats[0] : undefined;
            title = chat && "title" in chat ? chat.title : "";
          } else {
            const upd = await client.invoke(new Api.channels.JoinChannel({ channel: t.username }));
            const chat = "chats" in upd ? upd.chats[0] : undefined;
            title = chat && "title" in chat ? chat.title : t.username;
          }
          console.log(`${label} ✓ unido: ${title}`);
          result.unido!++;
        } catch (err) {
          const msg = (err as Error & { seconds?: number }).message ?? "";
          const wait = (err as { seconds?: number }).seconds;
          if (/FLOOD_WAIT/.test(msg) && wait && wait <= 600 && attempt === 0) {
            console.log(`${label} … Telegram pide esperar ${wait} s`);
            await sleep((wait + 2) * 1000);
            continue;
          }
          if (/USER_ALREADY_PARTICIPANT/.test(msg)) {
            console.log(`${label} = ya estaba`);
            result.ya_estaba!++;
          } else if (/INVITE_REQUEST_SENT/.test(msg)) {
            console.log(`${label} ⏳ solicitud enviada (un admin debe aceptarla)`);
            result.solicitud_enviada!++;
          } else {
            const why = /INVITE_HASH_EXPIRED|INVITE_HASH_INVALID/.test(msg)
              ? "link vencido o inválido"
              : /CHANNELS_TOO_MUCH/.test(msg)
                ? "la cuenta llegó al máximo de grupos"
                : /USERNAME_(NOT_OCCUPIED|INVALID)/.test(msg)
                  ? "ese @nombre no existe"
                  : msg.slice(0, 80);
            console.log(`${label} ✗ ${why}`);
            result.error!++;
          }
        }
        break;
      }
      if (i < raws.length - 1) await sleep(12_000);
    }
  } finally {
    await client.disconnect();
    await client.destroy().catch(() => {});
  }
  console.log("\nResumen:", result);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
