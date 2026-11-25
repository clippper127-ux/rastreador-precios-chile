import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="Esta página no existe"
      description="Puede que el link esté mal escrito o que el producto ya no se siga."
      className="mt-10"
    >
      <Button asChild>
        <Link href="/">Ir al inicio</Link>
      </Button>
    </EmptyState>
  );
}
