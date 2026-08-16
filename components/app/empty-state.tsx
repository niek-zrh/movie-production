import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Empty states are invitations (spec §9.3): message + the action right there. */
export function EmptyState({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-8 py-14 text-center",
        className,
      )}
    >
      {icon && <div className="text-muted-foreground [&_svg]:size-7">{icon}</div>}
      <p className="max-w-sm text-sm text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}
