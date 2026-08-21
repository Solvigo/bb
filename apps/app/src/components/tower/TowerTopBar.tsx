import { Link, useLocation } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  APP_ROOT_ROUTE_PATH,
  getPluginPanelRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";

/**
 * THE UPPER-LEVEL DASHBOARD — carve phase 3, the slim bar that replaces an 11,000-line rail.
 *
 * WHAT IS IN IT AND WHERE EACH ITEM COMES FROM, because a navigation bar is exactly the place a
 * plausible-looking invented list would never be noticed:
 *   BOARD HOME   the app's own root, which phase 1 made the fleet board.
 *   THE PANELS   `usePluginSlots().navPanels` — THE RAIL'S OWN SOURCE, not a list I typed. Whatever
 *                is installed appears; nothing installed appears from nowhere. This is also why the
 *                rail going does not orphan Tower, Automations, Knowledge or anything else somebody
 *                installs later: they keep a home without this file knowing their names.
 *   SETTINGS     the settings route, which keeps its own SectionSidebar (collision (b) in the carve
 *                map) and is therefore untouched by this phase.
 *
 * AND ONE SLOT IS DELIBERATELY INERT: thread search. The rail owned it — `AppSidebar` registers the
 * `thread.search` command and renders `SidebarThreadSearchPanel` against data it had at hand (recents,
 * project names, the keyboard cursor). Lifting that panel out is real work, priced in the phase report;
 * until it is lifted, a search button here would dispatch a command with no handler — a control that
 * looks like it acts, which is the one defect this fleet keeps paying for. So it is drawn DISABLED
 * with the reason on it. An honest absence beats a false affordance, and it keeps the bar's shape
 * judgeable now rather than after the wiring.
 *
 * THE TYPE AND THE GREYS ARE bb ROLES, not hexes — `bg-card`, `border-border`, `text-*-foreground`,
 * the mono metadata tier — so under the fleet's stored tower-grey palette this bar IS the blueprint's,
 * and under any other palette it is that palette's. Same law as the airways pane.
 */
const ROW = "flex h-10 shrink-0 items-center gap-1 border-b border-border bg-card px-2";
const ITEM =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
const ITEM_ON = "inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground";
const BRAND = "mr-1 inline-flex items-center gap-2 rounded-md px-2 py-1";
const BRAND_NAME = "text-xs font-semibold tracking-[0.14em] uppercase text-foreground";
const INERT =
  "inline-flex cursor-default items-center gap-1.5 rounded-md px-2 py-1 text-xs text-subtle-foreground opacity-60";

export function TowerTopBar() {
  const location = useLocation();
  const { navPanels } = usePluginSlots();
  const onBoard = location.pathname === APP_ROOT_ROUTE_PATH || location.pathname.startsWith("/tower");
  // The board plugin, if it is installed — used only for the brand mark. Absent is fine: the fallback
  // glyph draws and the bar still works, which is the same honesty the board route itself applies.
  const boardPanel = navPanels.find((panel) => panel.pluginId === "airways");
  const settingsPath = getSettingsRoutePath();
  const onSettings = location.pathname.startsWith(settingsPath);
  return (
    <nav className={ROW} aria-label="Tower" data-tower-top-bar="">
      <Link to={APP_ROOT_ROUTE_PATH} className={cn(BRAND, onBoard && "bg-muted")}>
        {/* THE REAL MARK, not a stand-in glyph: `PluginIcon` serves the board plugin's own
            path-shaped branding svg (bb paints it as a mask in currentColor), so the brand here is
            the same mark bb draws for that plugin everywhere else. bb's icon set has no jet, and a
            near-enough glyph would have been a second identity for one thing. */}
        {boardPanel ? (
          <PluginIcon pluginId={boardPanel.pluginId} icon={boardPanel.icon} className="size-3.5 text-primary" />
        ) : (
          <Icon name="Layers" className="size-3.5 text-primary" />
        )}
        <span className={BRAND_NAME}>Tower</span>
      </Link>

      {navPanels.map((panel) => {
        const path = getPluginPanelRoutePath({ pluginId: panel.pluginId, path: panel.path, subPath: "" });
        const active = location.pathname.startsWith(`/plugins/${panel.pluginId}/${panel.path}`);
        return (
          <Link
            key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
            to={path}
            className={active ? ITEM_ON : ITEM}
            data-tower-panel={panel.pluginId}
          >
            <PluginIcon pluginId={panel.pluginId} icon={panel.icon} className="size-3.5" />
            <span>{panel.title}</span>
          </Link>
        );
      })}

      <span className="flex-1" />

      {/* THE INERT SLOT. See the note at the top: the search panel is still inside the rail, so this
          says so instead of pretending. */}
      <span
        className={INERT}
        data-tower-search="pending"
        title="Thread search still lives inside the rail's data context; it moves here when that panel is lifted out (see the phase report)."
      >
        <Icon name="Search" className="size-3.5" />
        <span>search · not lifted yet</span>
      </span>

      <Link to={settingsPath} className={onSettings ? ITEM_ON : ITEM} data-tower-settings="">
        <Icon name="Settings" className="size-3.5" />
        <span>Settings</span>
      </Link>
    </nav>
  );
}
