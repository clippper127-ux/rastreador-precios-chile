import { LogIn } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/supabase/server";
import { DesktopNav } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";

export async function SiteHeader() {
  const user = await getUser();
  const initial = (user?.email?.[0] ?? "?").toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur-lg supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-full font-semibold tracking-tight">
          <Logo />
          <span>Rastreador</span>
        </Link>

        <DesktopNav />

        <div className="flex items-center gap-1">
          <ThemeToggle />
          {user ? (
            <Link
              href="/configuracion"
              aria-label={`Cuenta de ${user.email}`}
              className="ml-1 grid size-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
            >
              {initial}
            </Link>
          ) : (
            <Button asChild size="sm" className="ml-1">
              <Link href="/login">
                <LogIn aria-hidden />
                Entrar
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="size-8">
      <rect width="32" height="32" rx="10" className="fill-primary" />
      <path
        d="M8 20.5l5-5 4 3.5 7-8"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
      <circle cx="24" cy="11" r="2.5" className="fill-deal" />
    </svg>
  );
}
