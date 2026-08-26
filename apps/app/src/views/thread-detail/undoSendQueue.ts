import type { PromptInput } from "@bb/domain";
import type { PromptDraftState } from "@/lib/prompt-draft";
import type { SendMessageMutationRequest } from "./threadDetailMutationTypes";

export const UNDO_SEND_WINDOW_MS = 3000;

/**
 * How the entry reaches the agent once its window closes.
 *
 * `auto` re-decides queue-vs-send at dispatch time, because the runtime may
 * have started or stopped during the window. `send` carries a request that was
 * already resolved from the submitted input and is dispatched verbatim.
 */
export type PendingSendDispatch =
  | { kind: "auto" }
  | { kind: "send"; request: SendMessageMutationRequest };

export interface PendingSend {
  id: string;
  /** Restored into the composer verbatim when the send is undone. */
  draft: PromptDraftState;
  input: PromptInput[];
  dispatch: PendingSendDispatch;
  expiresAt: number;
}

export function remainingMs(entry: PendingSend, now: number): number {
  return Math.max(0, entry.expiresAt - now);
}

/**
 * Whole seconds still left on the clock, as a countdown reads them: a window
 * with any time at all on it shows at least 1.
 */
export function remainingSeconds(entry: PendingSend, now: number): number {
  return Math.ceil(remainingMs(entry, now) / 1000);
}

export function hasExpired(entry: PendingSend, now: number): boolean {
  return entry.expiresAt <= now;
}

/**
 * Entries whose window has closed, in the order they were sent. Dispatch order
 * is enqueue order, so a scan in array order is already FIFO.
 */
export function partitionExpired(
  entries: readonly PendingSend[],
  now: number,
): { expired: PendingSend[]; waiting: PendingSend[] } {
  const expired: PendingSend[] = [];
  const waiting: PendingSend[] = [];
  for (const entry of entries) {
    if (hasExpired(entry, now)) {
      expired.push(entry);
    } else {
      waiting.push(entry);
    }
  }
  return { expired, waiting };
}

/**
 * The entry Escape undoes: the most recent one, which is the one the user is
 * regretting.
 */
export function latestUndoTarget(
  entries: readonly PendingSend[],
): PendingSend | null {
  return entries.length === 0 ? null : (entries.at(-1) ?? null);
}

export function withoutEntry(
  entries: readonly PendingSend[],
  id: string,
): PendingSend[] {
  return entries.filter((entry) => entry.id !== id);
}
