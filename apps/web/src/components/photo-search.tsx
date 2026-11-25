"use client";

import { isValidEan } from "@rastreador/core";
import { Camera, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { identifyPhoto } from "@/app/photo-actions";
import { Button } from "@/components/ui/button";

/*
 * Buscar con una foto:
 * 1. Se reduce la imagen en el navegador (máx. 1280 px).
 * 2. Se intenta leer un código de barras EN TU DISPOSITIVO (BarcodeDetector nativo o ZXing). Nada sale del navegador.
 * 3. Si no hay código y el reconocimiento con IA está activo, la foto reducida se envía a Gemini para identificar el producto.
 */

type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "error"; text: string };

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
}

function downscale(img: HTMLImageElement, max = 1280): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function readBarcode(canvas: HTMLCanvasElement): Promise<string | undefined> {
  const valid = (v?: string | null) => (v && isValidEan(v) ? v : undefined);
  // Nativo (Chrome en Android/macOS): rápido y sin descargar nada.
  const Native = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } })
    .BarcodeDetector;
  if (Native) {
    try {
      const codes = await new Native({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] }).detect(canvas);
      const hit = codes.map((c) => valid(c.rawValue)).find(Boolean);
      if (hit) return hit;
    } catch {
      /* seguir con ZXing */
    }
  }
  // ZXing (JavaScript puro): se carga solo cuando hace falta.
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const result = new BrowserMultiFormatReader().decodeFromCanvas(canvas);
    return valid(result.getText());
  } catch {
    return undefined;
  }
}

export function PhotoSearchButton({ aiEnabled }: { aiEnabled: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      setStatus({ kind: "busy", text: "Buscando un código de barras…" });
      const canvas = downscale(await loadImage(file));
      const ean = await readBarcode(canvas);
      if (ean) {
        router.push(`/buscar?q=${ean}`);
        return;
      }
      if (!aiEnabled) {
        setStatus({
          kind: "error",
          text: "No encontramos un código de barras en la foto. Prueba enfocando el código, o escribe el producto. (El reconocimiento por IA no está activado.)",
        });
        return;
      }
      setStatus({ kind: "busy", text: "Reconociendo el producto…" });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
      if (!blob) throw new Error("No se pudo procesar la imagen.");
      const form = new FormData();
      form.append("photo", new File([blob], "foto.jpg", { type: "image/jpeg" }));
      const res = await identifyPhoto(form);
      if ("error" in res) {
        setStatus({ kind: "error", text: res.error });
        return;
      }
      router.push(`/buscar?q=${encodeURIComponent(res.query)}`);
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message || "No pudimos leer la foto." });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  const busy = status.kind === "busy";
  return (
    <div className="flex flex-col items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Foto del producto"
        onChange={(e) => onFile(e.currentTarget.files?.[0])}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Camera aria-hidden />}
        {busy ? status.text : "Buscar con una foto"}
      </Button>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        {aiEnabled
          ? "Leemos el código de barras en tu dispositivo. Si no hay, la foto se envía a Google Gemini para reconocer el producto."
          : "Toma una foto del código de barras: se lee en tu dispositivo, sin subir la foto."}
      </p>
      {status.kind === "error" && (
        <p role="alert" className="max-w-md text-center text-sm text-danger">
          {status.text}
        </p>
      )}
    </div>
  );
}
