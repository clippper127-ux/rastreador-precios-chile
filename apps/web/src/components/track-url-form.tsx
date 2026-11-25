"use client";

import { Link2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { trackUrl } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "Seguir con un link": pegas la ficha de un producto y queda seguido (lleva a su detalle). */
export function TrackUrlForm({ id = "track-url" }: { id?: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await trackUrl(url.trim());
          if (r?.error) setError(r.error);
        });
      }}
      className="flex flex-col gap-2"
    >
      <Label htmlFor={id}>Pega el link de un producto</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          type="url"
          inputMode="url"
          required
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="https://www.falabella.com/falabella-cl/product/…"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="flex-1"
        />
        <Button type="submit" disabled={pending || !url.trim()}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Link2 aria-hidden />}
          Seguir precio
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
