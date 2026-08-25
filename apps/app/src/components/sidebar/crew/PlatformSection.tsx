import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  getPluginPanelRoutePath,
  getSettingsRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";

interface PlatformRow {
  /** Stable across plugins: a built-in label, or `<pluginId>:<panelId>`. */
  key: string;
  icon: IconName;
  label: string;
  hint: string;
  to: string;
}

/**
 * What belongs to the whole instance rather than to any one crew: the skills
 * agents can carry, the connections it can reach, and what a new agent gets
 * when nobody chooses for it. Three shortcuts into real screens — none of these
 * rows opens a surface that does not exist.
 */
const PLATFORM_ROWS: PlatformRow[] = [
  {
    key: "Skills",
    icon: "Zap",
    label: "Skills",
    hint: "browse & install",
    to: getSkillsRoutePath(),
  },
  {
    key: "Connections",
    icon: "ElectricPlugs",
    label: "Connections",
    hint: "soon",
    to: getSettingsRoutePath("connections"),
  },
  {
    key: "Defaults",
    icon: "SlidersHorizontal",
    label: "Defaults",
    hint: "new agents",
    to: getSettingsRoutePath("defaults"),
  },
];

export function PlatformSection({
  labelClassName,
  onNavigate,
}: {
  labelClassName: string;
  onNavigate?: () => void;
}) {
  // A plugin nav panel is instance-wide by definition, so it lands here as one
  // more Platform row — below the built-ins, in registration order. The row is
  // a link and nothing more: the panel's own component only ever mounts on its
  // route, so a plugin that throws cannot take the rail down. With no panels
  // registered this appends nothing and the rail is exactly as it was.
  const { navPanels } = usePluginSlots();
  const rows = useMemo(
    () => [
      ...PLATFORM_ROWS,
      ...navPanels.map((panel) => ({
        key: `${panel.pluginId}:${panel.id}`,
        icon: pluginIconName(panel.icon),
        label: panel.title,
        hint: "",
        to: getPluginPanelRoutePath({
          pluginId: panel.pluginId,
          path: panel.path,
        }),
      })),
    ],
    [navPanels],
  );
  return (
    <div className="flex flex-col gap-0.5 px-2 group-data-[collapsible=icon]:hidden">
      <div className={cn(labelClassName, "mt-2 mb-0.5")}>Platform</div>
      {rows.map((row) => (
        <NavLink
          key={row.key}
          to={row.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
              isActive ? "bg-state-active" : "hover:bg-state-hover",
            )
          }
        >
          <Icon
            name={row.icon}
            className="size-4 shrink-0 text-subtle-foreground"
          />
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">
            {row.label}
          </span>
          <span className="shrink-0 font-tower-mono text-[10px] text-tower-fg-faint">
            {row.hint}
          </span>
        </NavLink>
      ))}
    </div>
  );
}

export default PlatformSection;
