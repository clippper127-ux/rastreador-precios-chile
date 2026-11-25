import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed bg-card/50 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-6" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
