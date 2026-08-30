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
 * Built-ins are brief and files; the recursive agent tree is the crew plugin's
 * surface tab. Clearance and Knowledge were tabs here and are not any more.
 */

function FilesSurfaceTab({ agentId }: AgentSurfaceTabProps) {
  return <FilesTab agentId={agentId} />;
}

function BriefSurfaceTab({ agentId }: AgentSurfaceTabProps) {
  return <BriefTab agentId={agentId} />;
}

/**
 * Idempotent by construction: the registry keys tabs by id, so registering the
 * same built-ins again replaces them rather than duplicating them. It carries
 * no "already done" flag on purpose — a module-scope flag in this file sat in
 * the temporal dead zone when a host imported it inside an import cycle, and the
 * whole panel died on `Cannot access 'registered' before initialization`.
 *
 * Call it from a component body rather than at module scope, so it runs once
 * every module is initialized instead of part-way through the graph.
 */
export function registerBuiltInAgentSurfaceTabs(): void {
  registerAgentSurfaceTab({
    id: "brief",
    label: "Brief",
    icon: "FileText",
    title: "What this agent was asked to do",
    order: 1,
    component: BriefSurfaceTab,
  });
  registerAgentSurfaceTab({
    id: "files",
    label: "Files",
    icon: "Folder",
    title: "The worktree this agent is working in",
    order: 2,
    component: FilesSurfaceTab,
  });
}
