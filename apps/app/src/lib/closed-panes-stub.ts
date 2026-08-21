import { atom } from "jotai";

/**
 * CARVE PHASE 2 — THE ONE LEAF STUB THE CARVE MAP PRICED.
 *
 * `ThreadActionsProvider` (a KEEP) called into the split layer for one thing: when a thread is
 * archived or deleted, close any panes showing it and tell the caller where to navigate afterwards.
 * With one surface there are no panes to close — so this reports "nothing closed", and the provider's
 * own `syncNavigationAfterClose` then falls back to its pre-split navigate-away, which is the branch
 * it already had for exactly this case (`focusedRoute: null`).
 *
 * IN ITS OWN FILE ON PURPOSE: it is the last thread between a keep and a deleted layer, so when the
 * final caller goes the deletion is one file rather than an archaeology exercise.
 */
export interface ClosePanesForThreadsResult {
  /** Always false now: there are no panes to close. */
  removedAny: boolean;
  /** Always null: nothing closed, so nothing to focus — the caller navigates as it did before splits. */
  focusedRoute: null;
}

const NOTHING_CLOSED: ClosePanesForThreadsResult = {
  removedAny: false,
  focusedRoute: null,
};

/** Write-only atom with the same call shape as the split layer's: `set(atom, threadIds)`. */
export const closePanesForThreadsAtom = atom(
  null,
  (_get, _set, _threadIds: readonly string[]): ClosePanesForThreadsResult => NOTHING_CLOSED,
);
