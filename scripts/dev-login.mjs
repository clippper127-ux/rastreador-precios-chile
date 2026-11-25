// Solo desarrollo: inicia sesión SIN enviar correo (evita el límite de emails de Supabase).
// Usa la API de administración para generar un link de acceso del único usuario del proyecto
// y lo abre en tu navegador predeterminado, pasando por /auth/confirm (token_hash).
// Uso:  node scripts/dev-login.mjs
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const site = process.env.DEV_SITE_URL ?? "http://localhost:3000";

if (!url || !key) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env (usa scripts/set-secret-key.ps1).");
  process.exit(1);
}
if (!/^http:\/\/localhost(:\d+)?$/.test(site)) {
  console.error("Este script es solo para localhost.");
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const usersRes = await fetch(`${url}/auth/v1/admin/users?per_page=2`, { headers });
if (!usersRes.ok) {
  console.error(`No se pudo leer usuarios (${usersRes.status}). ¿La secret key es correcta y vigente?`);
  process.exit(1);
}
const { users } = await usersRes.json();
if (!users?.length) {
  console.error("No hay usuarios todavía: pide un link en /login una vez para crear tu cuenta.");
  process.exit(1);
}
if (users.length > 1) {
  console.error("Hay más de un usuario; este atajo solo sirve con uno.");
  process.exit(1);
}

const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers,
  body: JSON.stringify({ type: "magiclink", email: users[0].email }),
});
if (!linkRes.ok) {
  console.error(`No se pudo generar el acceso (${linkRes.status}).`);
  process.exit(1);
}
const data = await linkRes.json();
const hashed = data.hashed_token ?? data.properties?.hashed_token;
if (!hashed) {
  console.error("La respuesta no trajo hashed_token.");
  process.exit(1);
}

const target = `${site}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=magiclink&next=%2Fseguimientos`;
// Se abre directo en el navegador; no se imprime para que no quede en el historial del terminal.
execFile("rundll32", ["url.dll,FileProtocolHandler", target]);
console.log("Listo: se abrió tu navegador con la sesión iniciada (el acceso vale una sola vez).");
