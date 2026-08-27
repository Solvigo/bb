import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getSettingsRoutePath, getSkillsRoutePath } from "@/lib/route-paths";

interface PlatformRow {
  key: string;
  icon: IconName;
  label: string;
  to: string;
}

/**
 * What belongs to the whole instance rather than to any one crew: the skills
 * agents can carry, the connections it can reach, and what a new agent gets
 * when nobody chooses for it. Three shortcuts into real screens — none of these
 * rows opens a surface that does not exist.
 *
 * THREE IS THE CONTRACT, not a starting point. The rail was overhauled to stop
 * being a list of everything the instance can do, and mounting every plugin
 * panel as a row put the whole graveyard straight back — Tower, Airways,
 * Knowledge and Automations reappeared beside the three that were kept.
 * Tower and Knowledge are agent-surface tabs and belong on an agent; the rest
 * are reachable from Settings. A panel earns a rail row by being added to
 * RAIL_PLUGIN_PANELS below, which is a deliberate act with a name on it —
 * never something a plugin can do to the operator's rail by existing.
 */
const PLATFORM_ROWS: PlatformRow[] = [
  {
    key: "Skills",
    icon: "Zap",
    label: "Skills",
    to: getSkillsRoutePath(),
  },
  {
    key: "Connections",
    icon: "ElectricPlugs",
    label: "Connections",
    to: getSettingsRoutePath("connections"),
  },
  {
    key: "Defaults",
    icon: "SlidersHorizontal",
    label: "Defaults",
    to: getSettingsRoutePath("defaults"),
  },
];

export function PlatformSection({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col px-2 pb-2 group-data-[collapsible=icon]:hidden">
      {PLATFORM_ROWS.map((row) => (
        <NavLink
          key={row.key}
          to={row.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex h-8 min-w-0 items-center gap-2 rounded-md px-2 transition-colors",
              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
            )
          }
        >
          <Icon
            name={row.icon}
            className="size-4 shrink-0 text-subtle-foreground"
          />
          <span className="min-w-0 truncate text-sm text-sidebar-foreground">
            {row.label}
          </span>
        </NavLink>
      ))}
    </div>
  );
}

export default PlatformSection;
