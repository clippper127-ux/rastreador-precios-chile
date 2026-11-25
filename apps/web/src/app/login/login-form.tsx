"use client";

import { KeyRound, Loader2, Mail, MailCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm({
  next,
  configured,
  googleEnabled,
}: {
  next: string;
  configured: boolean;
  googleEnabled: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Con las plantillas de correo por defecto de Supabase, el link vuelve a /auth/callback con un `code` (PKCE):
  // hay que abrirlo en el mismo navegador donde se pidió. Cuando haya SMTP propio (Fase 4), el correo
  // apuntará a /auth/confirm con `token_hash`, que funciona en cualquier navegador.
  const redirectTo = (path: "/auth/callback" | "/auth/confirm") =>
    `${window.location.origin}${path}?next=${encodeURIComponent(next)}`;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo("/auth/callback") },
    });
    if (error) {
      setStatus("error");
      setError(error.message);
    } else {
      setStatus("sent");
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setStatus("error");
      setError(
        /invalid login credentials/i.test(error.message)
          ? "Correo o contraseña incorrectos. Si todavía no creaste una contraseña, entra con un link y créala en Ajustes."
          : error.message,
      );
      return;
    }
    // La sesión queda guardada en este navegador (hasta 400 días o hasta que cierres sesión).
    const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/seguimientos";
    window.location.assign(safe);
  }

  async function signInWithGoogle() {
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo("/auth/callback") },
    });
    if (error) setError(error.message);
  }

  if (!configured) {
    return (
      <p className="rounded-xl bg-caution-soft p-4 text-sm text-caution">
        Supabase todavía no está configurado. Completa las variables en <code>.env</code> (ver{" "}
        <code>.env.example</code>) y reinicia el servidor.
      </p>
    );
  }

  if (status === "sent") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-deal-soft text-deal">
          <MailCheck aria-hidden className="size-6" />
        </div>
        <p className="font-medium">Revisa tu correo</p>
        <p className="text-sm text-muted-foreground">
          Te enviamos un link a <span className="font-medium text-foreground">{email}</span>. Ábrelo en este
          mismo navegador y usa el más reciente: los anteriores dejan de funcionar.
        </p>
        <Button variant="link" onClick={() => setStatus("idle")}>
          Usar otro correo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {googleEnabled && (
        <>
          <Button type="button" variant="outline" size="lg" onClick={signInWithGoogle}>
            <GoogleIcon />
            Continuar con Google
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />o con tu correo
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      {mode === "password" ? (
        <form onSubmit={signInWithPassword} className="flex flex-col gap-3">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="tu@correo.cl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={status === "error" || undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={status === "error" || undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
          <Button type="submit" size="lg" disabled={status === "sending"}>
            {status === "sending" ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
            Entrar
          </Button>
          <Button type="button" variant="link" onClick={() => { setMode("link"); setError(null); }}>
            ¿Sin contraseña? Entra con un link a tu correo
          </Button>
        </form>
      ) : (
        <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="tu@correo.cl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={status === "error" || undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
          <Button type="submit" size="lg" disabled={status === "sending"}>
            {status === "sending" ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}
            Enviarme un link de acceso
          </Button>
          <p className="text-xs text-muted-foreground">Después crea una contraseña en Ajustes para no depender del correo.</p>
          <Button type="button" variant="link" onClick={() => { setMode("password"); setError(null); }}>
            Entrar con contraseña
          </Button>
        </form>
      )}

      {error && (
        <p id="login-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
