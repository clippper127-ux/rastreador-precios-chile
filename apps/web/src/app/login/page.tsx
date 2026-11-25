import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/safe-next";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getUser } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);
  if (await getUser()) redirect(next);

  return (
    <div className="mx-auto flex max-w-md flex-col py-8 sm:py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Entrar</CardTitle>
          <CardDescription>Sin contraseña: te enviamos un link a tu correo.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p role="alert" className="mb-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">
              {error === "browser"
                ? "Abriste el link en un navegador distinto al que lo pidió. Pide uno nuevo aquí y ábrelo en este mismo navegador."
                : "El link expiró o ya se usó. Pide uno nuevo y usa el correo más reciente."}
            </p>
          )}
          <LoginForm
            next={next}
            configured={getSupabaseEnv() !== null}
            googleEnabled={process.env.AUTH_GOOGLE_ENABLED === "true"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
