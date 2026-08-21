import type { WorkspaceContent } from "@/lib/workspace-content";

/**
 * CARVE PHASE 2 — A STUB WHOSE LIFETIME IS ONE PHASE.
 *
 * This was the sidebar's read of the split layout: which rows are open in a pane, plus the mini-map
 * slots the rail drew for them. The split layout is gone, so there is nothing to indicate — and every
 * caller is a rail file that phase 3 deletes outright (ThreadRow, ProjectList, TopLevelSidebarSection,
 * SidebarSectionRow, SplitPaneMiniMap, BuiltInSidebarSection, PluginNavSidebarItems). Rewriting seven
 * rail files to remove the calls, one phase before deleting all seven, is churn with a chance of
 * breaking a rail we are about to remove.
 *
 * SO THIS RETURNS THE HONEST ANSWER FOR AN APP WITH NO PANES — nothing is open in a split, and there
 * is no mini-map — with the SAME EXPORTED SHAPES the real module had, read out of git rather than
 * guessed, so no caller has to change to keep compiling.
 */
export interface MiniMapSlot {
  paneId: string;
  /** The real `PaneRect` field names, read out of git rather than guessed — SplitPaneMiniMap
   *  consumes them and would have compiled against invented ones only by luck. */
  rect: { x: number; y: number; w: number; h: number };
  isMe: boolean;
  isFocused: boolean;
}

export interface PaneContentSplitIndicator {
  /** Always false now: there are no panes to be open in. */
  isOpenInSplit: boolean;
  /** Always null now: nothing to draw. */
  miniMap: MiniMapSlot[] | null;
}

export interface ThreadSplitIndicatorTarget {
  id: string;
  projectId: string;
}

const NO_INDICATOR: PaneContentSplitIndicator = {
  isOpenInSplit: false,
  miniMap: null,
};

export function usePaneContentSplitIndicator(
  _content: WorkspaceContent,
  _enabled: boolean,
): PaneContentSplitIndicator {
  return NO_INDICATOR;
}

export function useThreadGroupSplitIndicator(
  _threads: readonly ThreadSplitIndicatorTarget[],
  _enabled: boolean,
): PaneContentSplitIndicator {
  return NO_INDICATOR;
}
