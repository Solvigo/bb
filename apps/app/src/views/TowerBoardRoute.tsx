import { Link, useParams } from "react-router-dom";
import { PageShell } from "@/components/ui/page-shell.js";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { PluginPanelView } from "@/views/PluginPanelView";
import { usePluginSlots } from "@/lib/plugin-slots";
import { getSettingsRoutePath } from "@/lib/route-paths";

/**
 * THE TOWER BOARD, as the app's default view — carve phase 1.
 *
 * WHAT THIS IS AND IS NOT. It is one route change: the app's root used to be the compose surface, and
 * it is now the fleet board. NOTHING IS DELETED — every other route, the rail, the split workspace and
 * the compose surface all still exist and still work, and reverting is removing the two <Route>
 * elements that render this file.
 *
 * THE BOARD IS NOT REIMPLEMENTED HERE, and that is the whole design of this file. It is the airways
 * plugin's own panel, mounted through the host's existing `PluginPanelView` — which already takes
 * explicit `pluginId`/`panelPath`/`subPath` props rather than reading them from the route, so mounting
 * it outside its own route needs no change to it. So the board the operator judges here is the SAME
 * bundle, the same rpc and the same components as the panel he already has, tracking it as it changes.
 * A copy of the board inside this app would be a second implementation to keep in step, and the first
 * divergence would be invisible.
 *
 * WHY THE CATCH-ALL SPLAT IS STILL SplitWorkspaceRoute, deliberately, though the brief said "replace
 * the catch-all": that splat is what serves EVERY thread url, every plugin panel url and the legacy
 * project routes (see SplitWorkspaceRoute's own route matching). Replacing it wholesale would strand
 * all of them. The DEFAULT VIEW is what a bare url lands on, so that is the route this takes — plus
 * `/tower/*` so the board's own internal routes stay deep-linkable.
 *
 * AND IT SAYS WHY WHEN THERE IS NO BOARD. `PluginPanelView` degrades to a generic "panel not
 * available" placeholder, which is right for a deep link and wrong for a home page: a board-first app
 * whose board is missing must name the reason and offer a way out, or the operator is looking at a
 * dead end with no next move.
 */
const BOARD_PLUGIN_ID = "airways";
const BOARD_PANEL_PATH = "airways";

export default function TowerBoardRoute({ subPath }: { subPath?: string } = {}) {
  // ONE COMPONENT, TWO ROUTES: mounted at "/" there is no splat, and at "/tower/*" the remainder is
  // the board's own internal route — the same  contract every plugin panel already has.
  const params = useParams<{ "*": string }>();
  const panelSubPath = subPath ?? params["*"] ?? "";
  const { navPanels } = usePluginSlots();
  const panel = navPanels.find(
    (candidate) =>
      candidate.pluginId === BOARD_PLUGIN_ID && candidate.path === BOARD_PANEL_PATH,
  );
  if (!panel) {
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <EmptyStatePanel className="flex flex-col gap-2 rounded-lg p-6 text-sm">
          <span className="font-semibold">The fleet board is not loaded.</span>
          <span className="text-muted-foreground">
            This app&apos;s home is the <code>{BOARD_PLUGIN_ID}</code> plugin&apos;s board panel. Plugin
            frontends load after first paint, so this can be a moment of waiting — but if it persists,
            the plugin is not installed, not enabled, or its bundle failed to load on this server.
          </span>
          <span className="text-muted-foreground">
            Check it under <Link to={getSettingsRoutePath("plugins")}>Settings → Plugins</Link>. Every
            other surface still works: nothing was removed to put the board here.
          </span>
        </EmptyStatePanel>
      </PageShell>
    );
  }
  return (
    <PluginPanelView
      pluginId={BOARD_PLUGIN_ID}
      panelPath={BOARD_PANEL_PATH}
      subPath={panelSubPath}
    />
  );
}
