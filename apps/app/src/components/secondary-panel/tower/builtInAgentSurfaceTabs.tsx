import { FleetOverviewTab } from "./FleetOverviewTab";
import { BriefTab } from "./BriefTab";
import { FilesTab } from "./FilesTab";
import {
  registerAgentSurfaceTab,
  type AgentSurfaceTabProps,
} from "./agentSurfaceRegistry";

/**
 * The tabs every agent has, registered through the same registry a plugin
 * uses. Going through the front door keeps the seam honest: if registration
 * were good enough for everyone except the built-ins, the built-ins would
 * quietly drift into privileges nobody else could have.
 *
 * An agent's surface is chat, its crew board, its browser and its brief, and
 * that is the whole set. Clearance and Knowledge were tabs here and are not
 * any more: what Clearance showed — the asks waiting on you — surfaces on the
 * crew board's needs-attention, and a second place to read the same asks is a
 * second place for them to go stale.
 */

function CrewSurfaceTab({ agentId, viewerRole }: AgentSurfaceTabProps) {
  return <FleetOverviewTab scopeThreadId={agentId} viewerRole={viewerRole} />;
}

function FilesSurfaceTab({ agentId }: AgentSurfaceTabProps) {
  return <FilesTab agentId={agentId} />;
}

function BriefSurfaceTab({ agentId }: AgentSurfaceTabProps) {
  return <BriefTab agentId={agentId} />;
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
    id: "files",
    label: "Files",
    icon: "Folder",
    title: "The worktree this agent is working in",
    order: 2,
    component: FilesSurfaceTab,
  });
  registerAgentSurfaceTab({
    id: "brief",
    label: "Brief",
    icon: "FileText",
    title: "What this agent was asked to do",
    order: 1,
    component: BriefSurfaceTab,
  });
}
