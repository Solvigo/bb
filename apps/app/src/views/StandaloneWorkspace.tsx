import { RootComposeView } from "@/views/RootComposeView";
import { PluginPanelView } from "@/views/PluginPanelView";
import { ThreadDetailView } from "@/views/thread-detail/ThreadDetailView";
import type { WorkspaceContent } from "@/lib/workspace-content";

/**
 * ONE SURFACE, FROM THE ROUTE — carve phase 2.
 *
 * This is `SplitThreadArea`'s own `StandalonePaneContent` promoted out of it, unchanged in behaviour:
 * the route says what it wants and exactly one surface renders it. The split area had this path
 * already (it is what it rendered when splits were unavailable), which is why deleting 962 lines of
 * split model plus its assembly costs no new rendering logic — the single-pane case was never the
 * exception, it was the base case with a tree wrapped around it.
 *
 * `surface="page"` is the presentation the standalone path always used: full width, no pane card, no
 * pane header. That is now the only presentation there is.
 */
export function StandaloneWorkspace({ content }: { content: WorkspaceContent }) {
  if (content.kind === "thread") return <ThreadDetailView surface="page" />;
  if (content.kind === "new-thread") return <RootComposeView />;
  return (
    <PluginPanelView
      pluginId={content.pluginId}
      panelPath={content.panelPath}
      subPath={content.subPath}
    />
  );
}
