"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export interface StoreLink {
  id: string;
  name: string;
  url: string;
  /** La extensión trae los resultados de esta tienda a la comparación. */
  viaExtension: boolean;
  captured: boolean;
}

/**
 * Botones "Buscar en <tienda>". Al abrir una tienda con extensión, la página se refresca sola
 * durante 2 minutos para mostrar los resultados que la extensión envíe.
 */
export function StoreSearchLinks({ links }: { links: StoreLink[] }) {
  const router = useRouter();
  const [watching, setWatching] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  function startWatching() {
    if (timer.current) clearInterval(timer.current);
    setWatching(true);
    const until = Date.now() + 2 * 60_000;
    timer.current = setInterval(() => {
      if (Date.now() > until) {
        clearInterval(timer.current!);
        setWatching(false);
        return;
      }
      router.refresh();
    }, 4000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Button key={l.id} asChild variant={l.captured ? "secondary" : "outline"} size="sm">
            <a href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => l.viaExtension && startWatching()}>
              {l.captured ? "✓ " : ""}
              {l.name}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        ))}
      </div>
      {watching && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Esperando los resultados de la extensión… aparecerán aquí.
        </p>
      )}
    </div>
  );
}
