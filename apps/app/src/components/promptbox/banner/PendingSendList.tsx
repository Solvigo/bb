import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  remainingMs,
  remainingSeconds,
  UNDO_SEND_WINDOW_MS,
  type PendingSend,
} from "@/views/thread-detail/undoSendQueue";

export interface PendingSendListProps {
  entries: readonly PendingSend[];
  now: number;
  onUndo: (id: string) => void;
  windowMs?: number;
}

function PendingSendRow({
  entry,
  now,
  onUndo,
  windowMs,
}: {
  entry: PendingSend;
  now: number;
  onUndo: (id: string) => void;
  windowMs: number;
}) {
  const secondsLeft = remainingSeconds(entry, now);
  const elapsedFraction = 1 - remainingMs(entry, now) / windowMs;
  const preview = entry.draft.text.trim();

  return (
    <PromptStackCard ariaLabel="Message sending" className="overflow-hidden">
      <div className="flex min-h-8 items-center gap-1.5 px-3 py-1.5 text-xs">
        <Icon
          name="Clock"
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="shrink-0 font-medium text-foreground">Sending</span>
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground"
          title={preview}
        >
          {preview}
        </span>
        <span
          role="status"
          aria-live="polite"
          className="shrink-0 tabular-nums text-muted-foreground"
        >
          {secondsLeft.toFixed(1)}s
        </span>
        <button
          type="button"
          aria-label={`Undo sending "${preview}"`}
          className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded px-2 font-medium text-foreground transition-colors hover:bg-state-hover"
          onClick={() => onUndo(entry.id)}
        >
          <Icon
            name="ArrowTurnBackward"
            className="size-3.5"
            aria-hidden="true"
          />
          Undo
        </button>
      </div>
      <div
        aria-hidden="true"
        className="h-0.5 bg-tower-input-border"
        style={{
          transform: `scaleX(${elapsedFraction})`,
          transformOrigin: "left",
        }}
      />
    </PromptStackCard>
  );
}

/**
 * The messages sitting in their undo window, oldest first — the same order they
 * will reach the agent in.
 */
export function PendingSendList({
  entries,
  now,
  onUndo,
  windowMs = UNDO_SEND_WINDOW_MS,
}: PendingSendListProps) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <>
      {entries.map((entry) => (
        <PendingSendRow
          key={entry.id}
          entry={entry}
          now={now}
          onUndo={onUndo}
          windowMs={windowMs}
        />
      ))}
    </>
  );
}
