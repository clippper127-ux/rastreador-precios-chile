"use client";

import { Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { trackUrl } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** "Seguir" un link de tienda encontrado en un mensaje del radar (nada se sigue sin tu clic). */
export function TrackLinkButton({ url }: { url: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await trackUrl(url);
            if (r?.error) setError(r.error);
          })
        }
      >
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
        Seguir precio
      </Button>
    </span>
  );
}
