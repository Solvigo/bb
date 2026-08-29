import { type CSSProperties, type ReactNode, type Ref } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

export const PROMPT_STACK_CARD_ROW_HEIGHT = 32;
// The stack reads as the composer's own family, because it sits on top of the
// composer and is the same object to the eye. Measured off form[data-promptbox]
// rather than approximated: 22px, #1f1f1e, #2c2c2b hairline.
export const PROMPT_STACK_CARD_RADIUS_CLASS = "rounded-[22px]";
// Inner hover/focus targets stay small — the same treatment the composer gives
// its own inner controls, which sit at rounded-md inside its 22px shell. Corner
// arcs are not matched to the outer radius: an inlay is nowhere near the corner.
export const PROMPT_STACK_INLAY_RADIUS_CLASS = "rounded";
export const PROMPT_STACK_INLAY_INSET_CLASS = "p-1";
export const PROMPT_STACK_INLAY_SEGMENT_CLASS = cn(
  "min-h-6 px-2 py-1",
  PROMPT_STACK_INLAY_RADIUS_CLASS,
);
// Compact inlays use a 2px inset, and rounded-md keeps a header segment tight
// without adding extra height.
export const PROMPT_STACK_COMPACT_INLAY_INSET_CLASS = "p-0.5";
export const PROMPT_STACK_COMPACT_INLAY_SEGMENT_CLASS = cn(
  "min-h-6 px-2 py-0.5",
  "rounded-md",
);

const BASE_CHROME = cn(
  PROMPT_STACK_CARD_RADIUS_CLASS,
  "border border-tower-input-border bg-[#1f1f1e]",
);

export interface PromptStackCardProps {
  children: ReactNode;
  /**
   * Accessible region label. When provided the card renders as
   * <section aria-label={...}>; otherwise it renders as a plain <div>.
   */
  ariaLabel?: string;
  className?: string;
  rootRef?: Ref<HTMLElement>;
  style?: CSSProperties;
  /**
   * Makes the card keyboard-focusable — set to 0 when the card is itself a
   * scroll region (e.g. a height-capped list) so keyboard users can scroll it.
   */
  tabIndex?: number;
}

/**
 * Shared chrome for the stack of context cards rendered above the FollowUp
 * prompt box (today: ContextBanner + QueuedMessagesList). Owns the
 * bordered/rounded/raised surface only — each consumer owns its internal
 * padding and layout. The point of the primitive is so the whole stack stays
 * visually unified and a future "compact" stack treatment can plug in here.
 */
export function PromptStackCard({
  children,
  ariaLabel,
  className,
  rootRef,
  style,
  tabIndex,
}: PromptStackCardProps) {
  if (ariaLabel) {
    return (
      <section
        ref={rootRef}
        aria-label={ariaLabel}
        className={cn(BASE_CHROME, className)}
        style={style}
        tabIndex={tabIndex}
      >
        {children}
      </section>
    );
  }
  return (
    <div
      ref={rootRef as Ref<HTMLDivElement>}
      className={cn(BASE_CHROME, className)}
      style={style}
      tabIndex={tabIndex}
    >
      {children}
    </div>
  );
}
