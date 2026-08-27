import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

interface SecondaryPanelEmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  description?: ReactNode;
  icon: IconName;
  iconClassName?: string;
  title: ReactNode;
}

/** Shared quiet zero-state for every built-in right-panel tab. */
export function SecondaryPanelEmptyState({
  className,
  description,
  icon,
  iconClassName,
  title,
  ...props
}: SecondaryPanelEmptyStateProps) {
  return (
    <div
      className={cn(
        "grid h-full min-h-48 place-items-center px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      <div className="flex max-w-72 flex-col items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-full border border-tower-border bg-tower-panel text-tower-fg-dim">
          <Icon name={icon} className={cn("size-4", iconClassName)} aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-tower-fg-body">{title}</p>
          {description ? (
            <p className="text-xs leading-relaxed text-tower-fg-faint">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
