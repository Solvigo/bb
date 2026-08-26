import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { MACOS_WINDOW_NO_DRAG_CLASS } from "@/lib/bb-desktop";
import { TabPill } from "@/components/ui/tab-pill";

export interface PinnedIconTabProps {
  activeTreatment: "fill" | "underline";
  ariaLabel: string;
  ariaKeyshortcuts?: string;
  isActive: boolean;
  label: string;
  leadingVisual: ReactNode;
  onClick: () => void;
  title: string;
  usesDesktopChrome: boolean;
}

/**
 * An icon tab in a rendering surface's chrome row. Shared by the pilot's own
 * surface and by every agent's surface beneath it, so a drilled-down agent gets
 * the same chrome as the top level rather than a lookalike — the recursion is
 * only honest if the shell really is the same component.
 */
export function PinnedIconTab({
  activeTreatment,
  ariaLabel,
  ariaKeyshortcuts,
  isActive,
  label,
  leadingVisual,
  onClick,
  title,
  usesDesktopChrome,
}: PinnedIconTabProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid={label === "Info" ? "thread-info-tab" : undefined}
          className={cn(
            "shrink-0",
            usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
          )}
        >
          <TabPill
            label={label}
            ariaLabel={ariaLabel}
            ariaKeyshortcuts={ariaKeyshortcuts}
            iconOnly
            leadingVisual={leadingVisual}
            title={title}
            isActive={isActive}
            activeTreatment={activeTreatment}
            onSelect={onClick}
            closeAction={null}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export default PinnedIconTab;
