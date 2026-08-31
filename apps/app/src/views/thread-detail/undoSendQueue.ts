import type { PromptInput } from "@bb/domain";
import type { PromptDraftState } from "@/lib/prompt-draft";
import type { SendMessageMutationRequest } from "./threadDetailMutationTypes";

export const UNDO_SEND_WINDOW_MS = 1500;

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
 * Seconds still left on the clock, to a tenth, FLOORED.
 *
 * Floored so it can never overstate: whatever this says, at least that much
 * is really left. It reads 0 in the final sliver under a tenth of a second,
 * because that is the truth — see `remainingLabel` for what a countdown shows
 * there, which is not "0".
 */
export function remainingSeconds(entry: PendingSend, now: number): number {
  return Math.floor(remainingMs(entry, now) / 100) / 10;
}

/**
 * What the countdown may honestly display.
 *
 * TENTHS, because a 1.5s window cannot be told truthfully in whole seconds:
 * rounding up said "2s" over a window that was never two seconds long.
 *
 * And the last sliver is named rather than rounded. Clamping it to "0.1s"
 * claimed a tenth of a second that was not there — the same overstatement as
 * the old "2s", one order of magnitude down. Between expiry and a tenth there
 * is real time left but less than the smallest unit this can print, so it says
 * exactly that.
 *
 * Never more time than remains; never zero while time remains.
 */
export function remainingLabel(entry: PendingSend, now: number): string {
  const ms = remainingMs(entry, now);
  if (ms === 0) return "0s";
  if (ms < 100) return "<0.1s";
  return `${remainingSeconds(entry, now).toFixed(1)}s`;
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

/**
 * Overlays that own Escape outright while they are open. Undo yields to these
 * rather than closing a menu and cancelling a send on the same keypress.
 */
export const ESCAPE_OWNED_BY_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"]',
  '[role="listbox"]',
].join(",");

export interface EscapeShouldUndoArgs {
  hasPending: boolean;
  defaultPrevented: boolean;
  isOverlayOpen: boolean;
}

/**
 * Escape undoes only inside an open window, and only when nothing with a
 * stronger claim on the key is showing.
 *
 * Inside the window undo outranks the composer's own Escape-to-blur: the
 * composer keeps focus after a send, so leaving blur in front would spend the
 * user's first Escape on releasing the editor and let the message go.
 */
export function escapeShouldUndo({
  hasPending,
  defaultPrevented,
  isOverlayOpen,
}: EscapeShouldUndoArgs): boolean {
  return hasPending && !defaultPrevented && !isOverlayOpen;
}
