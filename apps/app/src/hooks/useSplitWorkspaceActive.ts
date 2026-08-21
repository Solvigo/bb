/**
 * FALSE, ALWAYS — carve phase 2.
 *
 * This predicate answered "does the split workspace render its own pane chrome", and BOTH sides of a
 * handoff read it: AppLayout suppressed its header when the panes owned one. That handoff is what
 * #1042 was about, which is why the policy lives in one place.
 *
 * The split workspace is gone, so the honest answer is `false` and the consequence is the correct one:
 * AppLayout owns the chrome for every route again, which is what it did before splits existed. Left at
 * its old `threadSplitsEnabled && !isCompactViewport`, this would have gone on claiming pane chrome
 * that nothing renders — suppressing the app header on a wide viewport for a pane header that no
 * longer exists. A stale predicate is worse than a deleted one: it is still consulted.
 *
 * KEPT AS A FUNCTION rather than inlined at its one call site: phase 3 deletes AppLayout, and a
 * constant with a name and a reason is easier to find and remove then than a `false` in a JSX guard.
 */
export function useSplitWorkspaceActive(): boolean {
  return false;
}
