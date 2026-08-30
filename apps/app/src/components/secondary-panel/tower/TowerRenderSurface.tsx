import { useCallback, useEffect, useMemo } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { usePluginSlots } from "@/lib/plugin-slots";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { PinnedIconTab } from "../PinnedIconTab";
import { SecondaryPanelEmptyState } from "../SecondaryPanelEmptyState";
import { useAgentSurfaceTabs } from "../useAgentSurfaceTabs";
import {
  emitAgentTeardown,
  listAgentSurfaceTabs,
  onAgentTeardown,
  resolveAgentSurfaceTabId,
  type AgentSurfaceTab,
  type ViewerRole,
} from "./agentSurfaceRegistry";
import { registerBuiltInAgentSurfaceTabs } from "./builtInAgentSurfaceTabs";
import { AgentSurfaceTabContent } from "./AgentSurfaceTabContent";


/**
 * The recursive rendering surface. The top-level shell is a commander chat plus
 * a rendering surface with tabs; drilling into an agent gives the SAME shell
 * scoped to that agent — its own chat, its own rendering surface. This is that
 * surface: a tab host scoped to one agent, so every agent has a place to bring
 * things up, recursively.
 *
 * It wears the SAME chrome as the outer surface — the shared PinnedIconTab in a
 * 38px row — rather than a lookalike. A recursion is only honest if the inner
 * shell really is the outer one.
 *
 * Its tabs come from a REGISTRY, not a literal, so a surface built elsewhere
 * (the embedded browser is the first) registers rather than being hardcoded
 * here. Built-ins register through the same front door.
 */
export function TowerRenderSurface({
  scopeThreadId,
  viewerRole = "lead",
}: {
  /** The agent this surface belongs to — in this harness, its thread id. */
  scopeThreadId: string;
  /** Where this agent sits in its crew; handed to every registered tab. */
  viewerRole?: ViewerRole;
}) {
  // Built-ins come from the module registry; plugins arrive through
  // `app.slots.experimental_agentSurfaceTab` and are appended in plugin order.
  // A plugin's tab id is namespaced by its plugin so two plugins choosing the
  // same id cannot collide with each other or with a built-in.
  const { agentSurfaceTabs: pluginTabs } = usePluginSlots();
  registerBuiltInAgentSurfaceTabs();
  const tabs = useMemo<AgentSurfaceTab[]>(
    () => [
      ...listAgentSurfaceTabs(),
      ...pluginTabs.map((slot) => ({
        id: `plugin:${slot.pluginId}:${slot.id}`,
        label: slot.label,
        icon: pluginIconName(slot.icon),
        title: slot.title,
        component: slot.component as unknown as AgentSurfaceTab["component"],
        pluginId: slot.pluginId,
        generation: slot.generation,
      })),
    ],
    [pluginTabs],
  );
  // The SAME per-agent persisted open set the top-level surface uses — this
  // surface is recursive precisely so a drilled-down agent is not a
  // lookalike, and that only holds if it remembers what was opened on it the
  // same way its own top-level surface would. An empty open set shows
  // nothing; nothing auto-opens just because it is first in the registry.
  const surfaces = useAgentSurfaceTabs(scopeThreadId, scopeThreadId);
  const openTabs = useMemo(
    () => tabs.filter((tab) => surfaces.openTabIds.includes(tab.id)),
    [tabs, surfaces.openTabIds],
  );
  const activeView = resolveAgentSurfaceTabId(surfaces.activeTabId, openTabs);

  // This surface is done with the agent: every tab holding something for it —
  // a browser context, a stream, a session — must let go.
  useEffect(() => {
    const agentId = scopeThreadId;
    return () => emitAgentTeardown(agentId);
  }, [scopeThreadId]);
  // Handed to every tab so a disposer only ever runs for the agent it belongs
  // to: the emitter is fleet-wide, and a tab must not tear down its context
  // because some other agent's surface closed.
  const registerTeardown = useCallback(
    (dispose: () => void) =>
      onAgentTeardown((agentId) => {
        if (agentId === scopeThreadId) dispose();
      }),
    [scopeThreadId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-surface font-tower-sans">
      <div
        className="flex h-[38px] shrink-0 items-center gap-1 border-b border-tower-header-border bg-tower-header px-2 text-tower-tab"
        role="toolbar"
        aria-label="Agent panel views"
      >
        {tabs.map((tab) => {
          const isOpen = surfaces.openTabIds.includes(tab.id);
          return (
            <PinnedIconTab
              key={tab.id}
              ariaLabel={`Show ${tab.label.toLowerCase()}`}
              isActive={activeView === tab.id}
              label={tab.label}
              leadingVisual={<Icon name={tab.icon} />}
              onClick={() => surfaces.open(tab.id)}
              onClose={isOpen ? () => surfaces.close(tab.id) : undefined}
              closeAriaLabel={`Close ${tab.label.toLowerCase()}`}
              title={tab.title}
              usesDesktopChrome={false}
              activeTreatment="fill"
            />
          );
        })}
      </div>
      <div className="relative min-h-0 flex-1">
        {openTabs.length === 0 ? (
          <SecondaryPanelEmptyState
            icon="Layers"
            title="Nothing open"
            description="Open a view above to bring it up for this agent."
          />
        ) : (
          openTabs.map((tab) => {
            const isVisible = activeView === tab.id;
            return (
              <div
                key={`${tab.id}:${tab.generation ?? 0}`}
                className={isVisible ? "h-full min-h-0" : "hidden"}
                aria-hidden={isVisible ? undefined : true}
              >
                <AgentSurfaceTabContent
                  tab={tab}
                  agentId={scopeThreadId}
                  onTeardown={registerTeardown}
                  viewerRole={viewerRole}
                  visible={isVisible}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default TowerRenderSurface;
