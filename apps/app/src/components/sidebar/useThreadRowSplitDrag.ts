import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getThreadRoutePath } from "@/lib/route-paths";

/**
 * CARVE PHASE 2 — A STUB WHOSE LIFETIME IS ONE PHASE. See `paneContentSplitIndicator` for why the
 * rail's split entry points are stubbed rather than excised one phase before the rail itself goes.
 *
 * THE GESTURE IS GONE AND THE ACTION IS NOT. `onPointerDown` is `undefined`, which is exactly how the
 * real hook signalled "splits are unavailable here" on compact viewports — every caller already gates
 * its drag affordance on that being absent, so nothing has to change to stop offering a drag.
 *
 * But `openInSplit` was also the cmd/ctrl-click and context-menu entry point, and the real hook's own
 * contract says it "falls back to plain navigation on compact viewports (splits disabled)". So it does
 * that: the thread OPENS, in the one surface there now is. Silently doing nothing would have turned a
 * working menu item into a control that looks like it acts — the defect this fleet keeps paying for.
 */
interface UseThreadRowSplitDragArgs {
  projectId: string;
  threadId: string;
  title: string;
}

export function useThreadRowSplitDrag({
  projectId,
  threadId,
}: UseThreadRowSplitDragArgs): {
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  openInSplit: () => void;
} {
  const navigate = useNavigate();
  const openInSplit = useCallback(() => {
    navigate(getThreadRoutePath({ projectId, threadId }));
  }, [navigate, projectId, threadId]);
  return { onPointerDown: undefined, openInSplit };
}
