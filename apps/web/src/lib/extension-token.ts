import "server-only";
import { schema, type Database } from "@rastreador/db";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

/*
 * Token por usuario para la extensión. En la base solo se guarda su hash SHA-256:
 * el token en claro se muestra una vez al generarlo y no se puede recuperar (solo regenerar).
 */
const PREFIX = "rpe_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueExtensionToken(db: Database, userId: string): Promise<string> {
  const token = PREFIX + randomBytes(32).toString("base64url");
  await db
    .insert(schema.profiles)
    .values({ id: userId, extensionTokenHash: hashToken(token) })
    .onConflictDoUpdate({ target: schema.profiles.id, set: { extensionTokenHash: hashToken(token) } });
  return token;
}

export async function revokeExtensionToken(db: Database, userId: string): Promise<void> {
  await db.update(schema.profiles).set({ extensionTokenHash: null }).where(eq(schema.profiles.id, userId));
}

/** Devuelve el userId dueño del token, o null. */
export async function userIdFromToken(db: Database, header: string | null): Promise<string | null> {
  const token = header?.match(/^Bearer\s+(rpe_[A-Za-z0-9_-]{20,100})$/)?.[1];
  if (!token) return null;
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.extensionTokenHash, hashToken(token)),
    columns: { id: true },
  });
  return profile?.id ?? null;
}

export async function hasExtensionToken(db: Database, userId: string): Promise<boolean> {
  const p = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, userId), columns: { extensionTokenHash: true } });
  return !!p?.extensionTokenHash;
}
