import * as React from "react";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  remainingMs,
  remainingLabel,
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
  const timeLeft = remainingLabel(entry, now);
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
        {/* VISUAL ONLY. This ticks ten times a second; in a live region that
            is ten announcements a second, which makes the banner unusable
            with a screen reader. The stable announcement is below. */}
        <span
          aria-hidden="true"
          className="shrink-0 tabular-nums text-muted-foreground"
        >
          {timeLeft}
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
  const [liveRegionText, setLiveRegionText] = React.useState("");
  const seenIds = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (entries.length === 0) {
      if (seenIds.current.size > 0) {
        seenIds.current.clear();
        setLiveRegionText("");
      }
      return;
    }

    const newEntries = entries.filter((e) => !seenIds.current.has(e.id));
    if (newEntries.length > 0) {
      newEntries.forEach((e) => seenIds.current.add(e.id));
      setLiveRegionText(
        newEntries
          .map(
            (entry) =>
              `Sending ${entry.draft.text.trim()}. Undo available for ${(windowMs / 1000).toFixed(1)} seconds.`
          )
          .join(" ")
      );
    }
  }, [entries, windowMs]);

  return (
    <>
      {/* Said ONCE per change. The string does not change as the clock runs, so a
          polite region announces the pending send and the way out of it and
          then stays quiet. The window is stated rather than counted. 
          The region is persistently mounted so screen readers reliably observe mutations. */}
      <span className="sr-only" role="status" aria-live="polite">
        {liveRegionText}
      </span>
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
