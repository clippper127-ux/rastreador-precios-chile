"use client";

import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title="Algo falló"
      description="No pudimos cargar esta pantalla. Puedes intentarlo de nuevo."
      className="mt-10"
    >
      <Button onClick={reset}>Reintentar</Button>
    </EmptyState>
  );
}
