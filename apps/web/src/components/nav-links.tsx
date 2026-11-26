"use client";

import { Bell, LayoutGrid, Radio, Search, Settings, Ticket } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Buscar", icon: Search },
  { href: "/seguimientos", label: "Seguimientos", icon: LayoutGrid },
  { href: "/radar", label: "Radar", icon: Radio },
  { href: "/cupones", label: "Cupones", icon: Ticket },
  { href: "/alertas", label: "Alertas", icon: Bell },
  { href: "/configuracion", label: "Ajustes", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/buscar") : pathname.startsWith(href);
}

/** Navegación de escritorio, dentro de la cabecera. */
export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
      {NAV.map(({ href, label }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-pill"
                className="absolute inset-0 -z-10 rounded-full bg-muted"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Barra inferior en móvil (mobile first: el pulgar llega fácil). */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon aria-hidden className={cn("size-5", active && "text-brand")} strokeWidth={active ? 2.25 : 1.75} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
