import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseEnv } from "./env";

export async function createClient() {
  // Leer cookies primero marca la ruta como dinámica aunque Supabase no esté configurado.
  const cookieStore = await cookies();
  const env = getSupabaseEnv();
  if (!env) return null;
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Llamado desde un Server Component: el proxy ya refresca la sesión.
        }
      },
    },
  });
}

/** Usuario actual validado contra Supabase (no confía solo en la cookie). */
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** Para páginas privadas: redirige al login si no hay sesión. */
export async function requireUser(next: string): Promise<User> {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}
