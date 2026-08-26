import { Component, type ErrorInfo, type ReactNode } from "react";

import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { SecondaryPanelEmptyState } from "../SecondaryPanelEmptyState";
import type {
  AgentSurfaceTab,
  AgentSurfaceTabProps,
} from "./agentSurfaceRegistry";

function TabCrashNotice({ label }: { label: string }) {
  return (
    <SecondaryPanelEmptyState
      icon="AlertTriangle"
      title={`${label} stopped working`}
      description="The rest of this surface is unaffected. Switch tabs and carry on."
      role="alert"
    />
  );
}

/**
 * Contains one tab's failure to that tab.
 *
 * Without it a single throwing tab takes the whole route down with it, which
 * is the difference between "the browser tab is broken" and "very little in
 * the app works" — the fleet has now seen the second one.
 */
class AgentSurfaceTabBoundary extends Component<
  { label: string; children: ReactNode },
  { crashed: boolean }
> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(
      `[agent-surface] the "${this.props.label}" tab crashed: ${error.message}`,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    if (this.state.crashed) return <TabCrashNotice label={this.props.label} />;
    return this.props.children;
  }
}

/**
 * Mounts one agent-surface tab, through the door its origin requires.
 *
 * A PLUGIN's tab goes through `PluginSlotMount`, which is the sanctioned
 * wrapper for every plugin slot and supplies two things at once: the plugin
 * context the SDK hooks read (`useRpc`/`useSettings` call `usePluginId()` and
 * throw without it), and a per-plugin crash boundary. Rendering the component
 * bare — which this surface did — makes a correctly written plugin component
 * throw on its first hook.
 *
 * `instanceId` is the agent, deliberately. This surface is recursive: the same
 * tab is mounted for the commander, for each lead, and for each sortie at once.
 * Keying crash state by plugin alone would let one agent's failure disable that
 * tab on every other agent's surface.
 *
 * A BUILT-IN tab has no plugin context to give it and gets the boundary alone.
 */
export function AgentSurfaceTabContent({
  tab,
  ...props
}: { tab: AgentSurfaceTab } & AgentSurfaceTabProps) {
  const Tab = tab.component;
  const content = <Tab {...props} />;

  if (tab.pluginId === undefined) {
    return (
      <AgentSurfaceTabBoundary label={tab.label}>
        {content}
      </AgentSurfaceTabBoundary>
    );
  }

  return (
    <PluginSlotMount
      pluginId={tab.pluginId}
      slotKind="agentSurfaceTab"
      slotId={tab.id}
      instanceId={props.agentId}
      crashFallback={<TabCrashNotice label={tab.label} />}
    >
      {content}
    </PluginSlotMount>
  );
}

export default AgentSurfaceTabContent;
