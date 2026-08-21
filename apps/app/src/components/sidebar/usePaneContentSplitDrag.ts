import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import type { WorkspaceContent } from "@/lib/workspace-content";

/**
 * CARVE PHASE 2 — A STUB WHOSE LIFETIME IS ONE PHASE. Same reasoning as its two siblings.
 *
 * `onPointerDown: undefined` is the documented "no split here" signal every caller already gates on;
 * `openInSplit` keeps working as PLAIN NAVIGATION, which is what the real hook did when splits were
 * off. The route for a piece of content is the same one-liner the real module had.
 */
function routeForContent(content: WorkspaceContent): string {
  if (content.kind === "thread") return getThreadRoutePath(content);
  if (content.kind === "new-thread") return getRootComposeRoutePath();
  return getPluginPanelRoutePath({
    pluginId: content.pluginId,
    path: content.panelPath,
    subPath: content.subPath,
  });
}

export function usePaneContentSplitDrag({
  content,
}: {
  content: WorkspaceContent;
  enabled?: boolean;
  label?: string;
}): {
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  openInSplit: () => void;
} {
  const navigate = useNavigate();
  const openInSplit = useCallback(() => {
    navigate(routeForContent(content));
  }, [content, navigate]);
  return { onPointerDown: undefined, openInSplit };
}
