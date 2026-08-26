import { matchPath, useLocation } from "react-router-dom";
import type { IconName } from "@bb/shared-ui/icon";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { useToolsHubExperiment } from "@/components/tools/tools-experiment-context";
import {
  SETTINGS_MACHINE_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROVIDER_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
} from "@/lib/route-paths";

/**
 * The settings buckets: shared between the settings sidebar (which replaces
 * the app sidebar on /settings routes) and SettingsView (which renders the
 * selected bucket's content).
 */
export const SETTINGS_NAV_SECTIONS = [
  { icon: "Settings", id: "general", label: "General" },
  { icon: "Palette", id: "appearance", label: "Appearance" },
  { icon: "SlidersHorizontal", id: "keyboard", label: "Keyboard" },
  { icon: "ChartColumn", id: "usage", label: "Usage limits" },
  { icon: "Folder", id: "files", label: "Files" },
  { icon: "Laptop", id: "machines", label: "Machines" },
  { icon: "PackageReceive", id: "updates", label: "Updates" },
  { icon: "Beaker", id: "experiments", label: "Experiments" },
  { icon: "Layers", id: "plugins", label: "Plugins" },
  { icon: "Code", id: "providers", label: "Coding harnesses" },
  { icon: "ElectricPlugs", id: "connections", label: "Connections" },
  { icon: "SlidersHorizontal", id: "defaults", label: "Defaults" },
  { icon: "MessageSquare", id: "community", label: "Community" },
  { icon: "Archive", id: "archived", label: "Archived threads" },
] as const satisfies readonly {
  icon: IconName;
  id: string;
  label: string;
}[];

export type SettingsNavSection = (typeof SETTINGS_NAV_SECTIONS)[number];

export type SettingsSectionId = SettingsNavSection["id"];

/**
 * A harness id is RUNTIME DATA, not a closed set the nav gets to decide.
 *
 * This used to be a hardcoded pair, which is why an instance that knew four
 * harnesses showed two in the sidebar and the other two could not be reached
 * at all. The harnesses now live on one page that asks the instance; the
 * per-harness route survives as a deep link into that page, and any id is
 * allowed through — the page says so if the instance does not know it, which
 * is a better answer than the nav redirecting as though the URL were malformed.
 */
export type SettingsProviderId = string;

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_NAV_SECTIONS.some((section) => section.id === value);
}

export interface SettingsNavState {
  /** Host id from /settings/machines/:hostId, else null. */
  activeMachineId: string | null;
  /** Plugin id from /settings/plugins/:pluginId, else null. */
  activePluginId: string | null;
  /** Provider id from /settings/providers/:providerId, else null. */
  activeProviderId: SettingsProviderId | null;
  /** Selected bucket; null while a provider or plugin page is active. */
  activeSection: SettingsSectionId | null;
  /** True when the :section URL segment is unknown (the view redirects). */
  hasUnknownSection: boolean;
  /** Enabled plugins that declared settings or settingsSection slots. */
  pluginEntries: PluginListItem[];
  /** Buckets visible on this host. */
  sections: readonly SettingsNavSection[];
}

/**
 * URL → settings navigation state. Uses matchPath on the location (not
 * useParams) so it works both inside the settings route element and in the
 * sidebar, which mounts outside the route tree.
 */
export function useSettingsNavState(): SettingsNavState {
  const location = useLocation();
  const toolsHubEnabled = useToolsHubExperiment();
  const { hasDaemon } = useHostDaemon();
  const { fileOpeners, settingsSections } = usePluginSlots();
  const settingsSectionPluginIds = new Set(
    settingsSections.map((section) => section.pluginId),
  );
  const pluginListQuery = usePluginList({ enabled: true });

  const pluginMatch = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, location.pathname);
  const providerMatch = matchPath(
    SETTINGS_PROVIDER_ROUTE_PATH,
    location.pathname,
  );
  const sectionMatch = matchPath(
    SETTINGS_SECTION_ROUTE_PATH,
    location.pathname,
  );
  // A machine page keeps the Machines bucket selected in the sidebar.
  const machineMatch = matchPath(
    SETTINGS_MACHINE_ROUTE_PATH,
    location.pathname,
  );
  const activeMachineId = machineMatch?.params.hostId ?? null;
  const activePluginId = pluginMatch?.params.pluginId ?? null;
  const providerParam = providerMatch?.params.providerId;
  const activeProviderId = providerParam ?? null;
  const sectionParam =
    activePluginId === null && providerMatch === null
      ? sectionMatch?.params.section
      : undefined;
  const hasUnknownSection =
    sectionParam !== undefined && !isSettingsSectionId(sectionParam);
  const activeSection: SettingsSectionId | null =
    activeMachineId !== null
      ? "machines"
      : // A harness route is a deep link INTO the harnesses page, so the nav
        // stays on that row rather than falling through to General.
        providerMatch !== null
        ? "providers"
        : activePluginId !== null
          ? null
          : sectionParam !== undefined && isSettingsSectionId(sectionParam)
            ? sectionParam
            : "general";

  const sections = SETTINGS_NAV_SECTIONS.filter((section) => {
    if (section.id === "plugins" && toolsHubEnabled) {
      return false;
    }
    if (section.id === "files") {
      return hasDaemon || fileOpeners.length > 0;
    }
    return true;
  });
  const pluginEntries = (pluginListQuery.data?.plugins ?? []).filter(
    (plugin) =>
      plugin.enabled &&
      (plugin.hasSettings || settingsSectionPluginIds.has(plugin.id)),
  );
  return {
    activeMachineId,
    activePluginId,
    activeProviderId,
    activeSection,
    hasUnknownSection,
    pluginEntries,
    sections,
  };
}

export function PluginNavIcon({ plugin }: { plugin: PluginListItem }) {
  return <PluginIcon pluginId={plugin.id} icon={plugin.icon ?? "Layers"} />;
}
