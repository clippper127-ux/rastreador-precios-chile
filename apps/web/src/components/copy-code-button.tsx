"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copia un código de cupón al portapapeles y confirma (también para lectores de pantalla). */
export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* sin permiso de portapapeles: el código igual está visible para copiarlo a mano */
        }
      }}
      aria-label={copied ? `Código ${code} copiado` : `Copiar código ${code}`}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copiado" : "Copiar"}
    </Button>
  );
}
