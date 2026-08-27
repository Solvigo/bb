import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getThreadRoutePath } from "@/lib/route-paths";
import { useCrews, type Crew, type CrewLead } from "./useCrews";
export { NewCrewButton } from "./NewCrewButton";

export const SIDEBAR_SECTION_LABEL_CLASS =
  "px-2 text-xs font-medium text-muted-foreground";

function CrewEntry({
  crew,
  onNavigate,
}: {
  crew: Crew;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const anyWorking = crew.leads.some((l) => l.working);
  // Every thread link carries its project scope. The projectless route resolves
  // to the PERSONAL project, so a lead on a real project rendered "belongs to a
  // different project" and the rail listed agents it could not open. The helper
  // already knows which form each project needs; hand-building the path is what
  // let the two drift apart.
  const threadPath = (threadId: string) =>
    getThreadRoutePath({ projectId: crew.projectId, threadId });
  return (
    <li>
      <div className="flex items-center">
        <button
          type="button"
          aria-label={open ? `Collapse ${crew.name}` : `Expand ${crew.name}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid size-6 shrink-0 place-items-center rounded text-subtle-foreground hover:bg-sidebar-accent"
        >
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            className="size-3.5"
          />
        </button>
        <NavLink
          to={threadPath(crew.commanderThreadId)}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
            )
          }
        >
          <Icon
            name="Folder"
            className={cn(
              "size-4 shrink-0",
              anyWorking ? "text-muted-foreground" : "text-subtle-foreground",
            )}
            aria-hidden
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {crew.name}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {crew.status}
            </span>
          </span>
        </NavLink>
      </div>
      {open && crew.leads.length > 0 ? (
        <ul className="ml-6 mt-0.5 flex flex-col">
          {crew.leads.map((lead) => (
            <AgentRow
              key={lead.threadId}
              agent={lead}
              threadPath={threadPath}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * One agent and whatever reports to it. Renders itself the same way at every
 * tier — a lead and a sortie are the same kind of thing at different places in
 * the tree, so the row does not learn its own rank to draw itself.
 */
function AgentRow({
  agent,
  threadPath,
  onNavigate,
}: {
  agent: CrewLead;
  threadPath: (threadId: string) => string;
  onNavigate?: () => void;
}) {
  return (
    <li>
      <NavLink
        to={threadPath(agent.threadId)}
        onClick={onNavigate}
        title={agent.status ?? undefined}
        className={({ isActive }) =>
          cn(
            "flex h-7 min-w-0 items-center gap-2 rounded-md px-2 transition-colors",
            isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
          )
        }
      >
        <Icon
          name="UserRound"
          className={cn(
            "size-3.5 shrink-0",
            agent.working ? "text-muted-foreground" : "text-subtle-foreground",
          )}
          aria-hidden
        />
        <span className="truncate text-[13px] text-foreground">
          {agent.name}
        </span>
      </NavLink>
      {agent.sorties.length > 0 ? (
        <ul className="ml-4 flex flex-col border-l border-tower-border pl-1">
          {agent.sorties.map((sortie) => (
            <AgentRow
              key={sortie.threadId}
              agent={sortie}
              threadPath={threadPath}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The sidebar's primary object is the CREW, not the thread: a New-crew button,
 * then one entry per crew — its commander, expanding to the leads reporting to
 * it. Raw threads keep their own section below this one, so every existing
 * route still works; they are simply no longer the first thing the operator
 * sees.
 */
/**
 * The one action the rail is built around. Pressing it stands up a commander
 * that interviews the operator; pressing it twice resumes that interview rather
 * than leaving a second half-built crew behind.
 */
/**
 * The rail's primary object is the CREW, not the thread: one entry per crew —
 * its commander, expanding to the leads reporting to it. Raw threads keep a
 * collapsed disclosure at the very bottom, so every existing route still works;
 * they are simply no longer what the operator reads first.
 */
export function CrewSidebarSection({
  headerTrailing,
  onNavigate,
}: {
  /** Sits on the Crews heading — search belongs beside what it searches. */
  headerTrailing?: ReactNode;
  onNavigate?: () => void;
}) {
  const { crews, loaded, failed, timedOut, reload } = useCrews();

  return (
    <div className="flex flex-col px-2 pb-2 group-data-[collapsible=icon]:hidden">
      <div className="mb-1 mt-3 flex items-center justify-between gap-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS}>Crews</span>
        {headerTrailing}
      </div>
      {!loaded ? (
        <p className="px-2 py-1 text-xs italic text-muted-foreground">
          Reading the fleet…
        </p>
      ) : failed && crews.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {timedOut
            ? "The fleet hasn't answered yet."
            : "Couldn't read the fleet."}{" "}
          <button
            type="button"
            onClick={reload}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {timedOut ? "Wait longer" : "Try again"}
          </button>
        </p>
      ) : crews.length === 0 ? (
        <p className="px-2 py-1 text-xs italic text-muted-foreground">
          No crews yet — start one above.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {crews.map((crew) => (
            <CrewEntry
              key={crew.commanderThreadId}
              crew={crew}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default CrewSidebarSection;
