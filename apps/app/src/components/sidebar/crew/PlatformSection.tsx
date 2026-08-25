import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getSettingsRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";

/**
 * What belongs to the whole instance rather than to any one crew: the skills
 * agents can carry, the connections it can reach, and what a new agent gets
 * when nobody chooses for it. Three shortcuts into real screens — none of these
 * rows opens a surface that does not exist.
 */
const PLATFORM_ROWS: {
  icon: IconName;
  label: string;
  hint: string;
  to: string;
}[] = [
  {
    icon: "Zap",
    label: "Skills",
    hint: "browse & install",
    to: getSkillsRoutePath(),
  },
  {
    icon: "ElectricPlugs",
    label: "Connections",
    hint: "soon",
    to: getSettingsRoutePath("connections"),
  },
  {
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
  return (
    <div className="flex flex-col gap-0.5 px-2 group-data-[collapsible=icon]:hidden">
      <div className={cn(labelClassName, "mt-2 mb-0.5")}>Platform</div>
      {PLATFORM_ROWS.map((row) => (
        <NavLink
          key={row.label}
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
