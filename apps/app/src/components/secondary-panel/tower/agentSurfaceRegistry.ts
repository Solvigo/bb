import type { ComponentType } from "react";
import type { IconName } from "@bb/shared-ui/icon";

/** Where in its crew the agent whose surface is being rendered sits. */
export type ViewerRole = "commander" | "lead" | "sortie";

export interface AgentSurfaceTabProps {
  /**
   * The agent this surface belongs to. In this harness an agent IS a thread,
   * so this is its thread id and nothing else — key any per-agent state by it
   * or the two sides will disagree about which agent they are looking at.
   */
  agentId: string;
  /**
   * False while another tab is selected. A tab STAYS MOUNTED when it goes
   * false: pause streams and timers, keep the context. Only `onAgentTeardown`
   * means dispose. The surface is recursive — the same tab renders at
   * commander, lead and sortie level — so visibility flips far more often than
   * a tab that only ever appeared once would expect.
   */
  visible: boolean;
  viewerRole: ViewerRole;
  /**
   * Register a disposer for this agent. It runs when the surface unmounts and
   * when the agent is archived or retired — the second case is the one that
   * matters, because an archived agent leaving a live session behind is how
   * resources are orphaned. Returns an unsubscribe.
   */
  onTeardown(dispose: () => void): () => void;
}

export interface AgentSurfaceTab {
  /** Stable and unique; also the tab's React key and its selection value. */
  id: string;
  label: string;
  icon: IconName;
  /** Native tooltip on the tab control. */
  title: string;
  component: ComponentType<AgentSurfaceTabProps>;
  /**
   * Registration order for tabs that must lead. Built-ins occupy 0–99; leave
   * it unset and the tab lands after them, in registration order.
   */
  order?: number;
  /**
   * Set only for a tab contributed by a plugin, and it decides how the tab is
   * mounted: a plugin's component must render inside its plugin context or the
   * SDK hooks it is entitled to use (useRpc, useSettings) throw on sight. A
   * built-in leaves this unset and is mounted directly.
   */
  pluginId?: string;
  /** The plugin slot's `generation`, bumped when its registrations are
   *  replaced. Folded into the React key so a reload remounts the tab instead
   *  of reusing a boundary that latched a crash from the previous bundle. */
  generation?: number;
}

const tabs = new Map<string, AgentSurfaceTab>();
const teardownListeners = new Set<(agentId: string) => void>();

/**
 * Add a tab to every agent's rendering surface. Registering the same id twice
 * replaces the earlier entry rather than showing it twice, so a hot reload
 * during development does not duplicate a tab.
 */
export function registerAgentSurfaceTab(tab: AgentSurfaceTab): void {
  tabs.set(tab.id, tab);
}

export function listAgentSurfaceTabs(): AgentSurfaceTab[] {
  return [...tabs.values()].sort(
    (a, b) => (a.order ?? 1_000) - (b.order ?? 1_000),
  );
}

/**
 * An agent's surface is finished with: its tabs must release whatever they hold
 * for it. Fired when a surface unmounts AND when its agent is archived or
 * retired — the second case is the one that matters, because an archived agent
 * leaving a live session behind is the orphan class that cost this fleet 11GB
 * of abandoned worktrees in a single afternoon.
 */
export function emitAgentTeardown(agentId: string): void {
  for (const listener of teardownListeners) listener(agentId);
}

export function onAgentTeardown(
  listener: (agentId: string) => void,
): () => void {
  teardownListeners.add(listener);
  return () => teardownListeners.delete(listener);
}
