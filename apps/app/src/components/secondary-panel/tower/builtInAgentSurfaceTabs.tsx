import { useThread } from "@/hooks/queries/thread-queries";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { FleetOverviewTab } from "./FleetOverviewTab";
import { ClearanceTab } from "./ClearanceTab";
import { KnowledgeTab } from "./KnowledgeTab";
import {
  registerAgentSurfaceTab,
  type AgentSurfaceTabProps,
} from "./agentSurfaceRegistry";

/**
 * The three tabs every agent has, registered through the same registry a
 * plugin uses. Going through the front door keeps the seam honest: if
 * registration were good enough for everyone except the built-ins, the
 * built-ins would quietly drift into privileges nobody else could have.
 */

function CrewSurfaceTab({ agentId, viewerRole }: AgentSurfaceTabProps) {
  return <FleetOverviewTab scopeThreadId={agentId} viewerRole={viewerRole} />;
}

function ClearanceSurfaceTab({ agentId }: AgentSurfaceTabProps) {
  return <ClearanceTab scopeThreadId={agentId} />;
}

function KnowledgeSurfaceTab({ agentId }: AgentSurfaceTabProps) {
  // The agent's knowledge theme is its own handle, so read it from the agent
  // rather than having every caller thread a label down by hand — a label
  // passed by hand goes stale the moment the agent is renamed.
  const { data: thread } = useThread(agentId);
  const theme = thread
    ? getThreadDisplayTitle(thread)
        .replace(/^(sp|plt|cm)[\s·-]+/i, "")
        .replace(/^(sp|plt|cm)[-_]/i, "")
    : undefined;
  return <KnowledgeTab scopeTheme={theme} />;
}

/**
 * Idempotent by construction: the registry keys tabs by id, so registering the
 * same three again replaces them rather than duplicating them. It carries no
 * "already done" flag on purpose — a module-scope flag in this file sat in the
 * temporal dead zone when a host imported it inside an import cycle, and the
 * whole panel died on `Cannot access 'registered' before initialization`.
 *
 * Call it from a component body rather than at module scope, so it runs once
 * every module is initialized instead of part-way through the graph.
 */
export function registerBuiltInAgentSurfaceTabs(): void {
  registerAgentSurfaceTab({
    id: "crew",
    label: "Crew",
    icon: "Layers",
    title: "Crew overview",
    order: 0,
    component: CrewSurfaceTab,
  });
  registerAgentSurfaceTab({
    id: "clearance",
    label: "Clearance",
    icon: "CircleCheck",
    title: "Yours to clear",
    order: 1,
    component: ClearanceSurfaceTab,
  });
  registerAgentSurfaceTab({
    id: "knowledge",
    label: "Knowledge",
    icon: "Brain",
    title: "Knowledge",
    order: 2,
    component: KnowledgeSurfaceTab,
  });
}
