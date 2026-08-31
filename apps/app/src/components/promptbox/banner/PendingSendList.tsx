import * as React from "react";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  remainingMs,
  remainingLabel,
  UNDO_SEND_WINDOW_MS,
  type PendingSend,
} from "@/views/thread-detail/undoSendQueue";
import { formatQueuedMessagePreview } from "@/views/thread-detail/threadQueuedMessages";

export interface PendingSendListProps {
  entries: readonly PendingSend[];
  now: number;
  onUndo: (id: string) => void;
  windowMs?: number;
}

function getSemanticFingerprint(entry: PendingSend): string {
  // A genuine same-ID replacement will have a new expiresAt and potentially a new input.
  return `${entry.id}|${entry.expiresAt}|${getSendPreview(entry)}`;
}

function getSendPreview(entry: PendingSend): string {
  // Use formatting for attachments and truncation matching queued messages.
  return formatQueuedMessagePreview(entry.input, { truncate: false });
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
  const preview = getSendPreview(entry);

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

export interface PendingSendLiveRegionProps {
  entries: readonly PendingSend[];
  windowMs?: number;
}

export function PendingSendLiveRegion({
  entries,
  windowMs = UNDO_SEND_WINDOW_MS,
}: PendingSendLiveRegionProps) {
  const [liveRegion, setLiveRegion] = React.useState({ text: "", id: 0 });
  
  // Keep track of the entries by a stable semantic fingerprint to detect replacement
  const previousFingerprints = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const currentFingerprints = new Set(
      entries.map(getSemanticFingerprint)
    );
    const prevFingerprints = previousFingerprints.current;
    
    previousFingerprints.current = currentFingerprints;

    const addedEntries = entries.filter(
      (e) => !prevFingerprints.has(getSemanticFingerprint(e))
    );

    const anyRemoved = [...prevFingerprints].some((f) => !currentFingerprints.has(f));

    if (addedEntries.length > 0) {
      setLiveRegion(prevLive => ({
        text: addedEntries
          .map(
            (entry) =>
              `Sending ${getSendPreview(entry)}. Undo available for ${(windowMs / 1000).toFixed(1)} seconds.`
          )
          .join(" "),
        id: prevLive.id + 1,
      }));
    } else if (anyRemoved) {
      setLiveRegion({ text: "", id: 0 });
    }
  }, [entries, windowMs]);

  return (
    <span className="sr-only" role="status" aria-live="polite">
      {liveRegion.text ? (
        <span key={liveRegion.id}>{liveRegion.text}</span>
      ) : null}
    </span>
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
