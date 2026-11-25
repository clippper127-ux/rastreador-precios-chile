"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // El servidor no conoce el tema: íconos y texto accesible se eligen con CSS (clase .dark) para evitar
  // diferencias de hidratación.
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun aria-hidden className="hidden dark:block" />
      <Moon aria-hidden className="dark:hidden" />
      <span className="sr-only dark:hidden">Cambiar a modo oscuro</span>
      <span className="hidden dark:inline dark:sr-only">Cambiar a modo claro</span>
    </Button>
  );
}
