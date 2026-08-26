import type { MouseEvent as ReactMouseEvent } from "react";
import {
  SectionSidebar,
  SectionSidebarIcon,
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import {
  SETTINGS_ROUTE_PATH,
  getSettingsPluginRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";
import { PluginNavIcon, useSettingsNavState } from "./settings-nav";

interface SettingsSidebarProps {
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
  appRoutePath: string;
}

/** Focused Settings navigation using the shared section-sidebar shell. */
export function SettingsSidebar({
  onResizeMouseDown,
  isResizing,
  showTopReserve,
  appRoutePath,
}: SettingsSidebarProps) {
  const {
    activePluginId,
    activeSection,
    pluginEntries,
    sections,
  } = useSettingsNavState();

  return (
    <SectionSidebar
      backLabel="Back to app"
      backTo={appRoutePath}
      isResizing={isResizing}
      onResizeMouseDown={onResizeMouseDown}
      showTopReserve={showTopReserve}
      testIdPrefix="settings"
    >
      <SectionSidebarLabel>Settings</SectionSidebarLabel>
      <div className="mt-1 space-y-0.5">
        {sections
          .filter((section) => section.id !== "archived")
          .map((section) => (
            <SectionSidebarRow
              key={section.id}
              active={activeSection === section.id}
              label={section.label}
              to={
                section.id === "general"
                  ? SETTINGS_ROUTE_PATH
                  : getSettingsRoutePath(section.id)
              }
            >
              <SectionSidebarIcon name={section.icon} />
            </SectionSidebarRow>
          ))}
      </div>
      {pluginEntries.length > 0 ? (
        <>
          <div className="mt-4">
            <SectionSidebarLabel>Plugins</SectionSidebarLabel>
          </div>
          <div className="mt-1 space-y-0.5">
            {pluginEntries.map((plugin) => (
              <SectionSidebarRow
                key={plugin.id}
                active={activePluginId === plugin.id}
                label={plugin.name ?? plugin.id}
                to={getSettingsPluginRoutePath(plugin.id)}
              >
                <PluginNavIcon plugin={plugin} />
              </SectionSidebarRow>
            ))}
          </div>
        </>
      ) : null}
      {sections.some((section) => section.id === "archived") ? (
        <>
          <div className="mt-4">
            <SectionSidebarLabel>Archived</SectionSidebarLabel>
          </div>
          <div className="mt-1 space-y-0.5">
            {sections
              .filter((section) => section.id === "archived")
              .map((section) => (
                <SectionSidebarRow
                  key={section.id}
                  active={activeSection === section.id}
                  label={section.label}
                  to={getSettingsRoutePath(section.id)}
                >
                  <SectionSidebarIcon name={section.icon} />
                </SectionSidebarRow>
              ))}
          </div>
        </>
      ) : null}
    </SectionSidebar>
  );
}
