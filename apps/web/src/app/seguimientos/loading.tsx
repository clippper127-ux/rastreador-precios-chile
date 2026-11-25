import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Cargando seguimientos">
      <Skeleton className="mb-3 h-10 w-64" />
      <Skeleton className="mb-8 h-5 w-96 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="flex gap-4">
              <Skeleton className="size-16 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
            <Skeleton className="mt-5 h-7 w-32" />
            <Skeleton className="mt-3 h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
