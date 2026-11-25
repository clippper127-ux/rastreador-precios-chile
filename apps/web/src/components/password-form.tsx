"use client";

import { Check, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

/** Crear o cambiar la contraseña, para entrar desde otro navegador o el celular sin esperar un correo. */
export function PasswordForm() {
  const [pwd, setPwd] = useState("");
  const [again, setAgain] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pwd.length < 8) return fail("Usa al menos 8 caracteres.");
    if (pwd !== again) return fail("Las contraseñas no coinciden.");
    setState("saving");
    setMsg(null);
    const { error } = await createClient().auth.updateUser({ password: pwd });
    if (error) {
      return fail(
        /different from the old/i.test(error.message)
          ? "Es igual a la actual."
          : /reauthentication|recent/i.test(error.message)
            ? "Por seguridad, cierra sesión, vuelve a entrar y créala de nuevo."
            : error.message,
      );
    }
    setPwd("");
    setAgain("");
    setState("ok");
  }

  function fail(m: string) {
    setState("error");
    setMsg(m);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">Nueva contraseña</Label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password-2">Repítela</Label>
          <Input id="new-password-2" type="password" autoComplete="new-password" minLength={8} required value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={state === "saving"}>
          {state === "saving" ? <Loader2 aria-hidden className="animate-spin" /> : <KeyRound aria-hidden />}
          Guardar contraseña
        </Button>
        {state === "ok" && (
          <p role="status" className="flex items-center gap-1 text-sm text-deal">
            <Check aria-hidden className="size-4" /> Lista. Desde ahora entras con correo y contraseña.
          </p>
        )}
        {state === "error" && msg && (
          <p role="alert" className="text-sm text-danger">
            {msg}
          </p>
        )}
      </div>
    </form>
  );
}
