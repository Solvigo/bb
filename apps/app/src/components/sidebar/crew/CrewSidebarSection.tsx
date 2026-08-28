import { useMemo, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getThreadRoutePath } from "@/lib/route-paths";
import { useProjectNames } from "@/hooks/queries/sidebar-navigation-query";
import { useCreateCrew } from "./useCreateCrew";
import { useCrews, type AgentLiveness, type Crew } from "./useCrews";
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
            // The folder belongs to the project above it. A commander is an
            // agent — the one you talk to — and drawing it as a folder too made
            // the two tiers read as one.
            name="UserRound"
            className={cn(
              "size-4 shrink-0",
              anyWorking ? "text-muted-foreground" : "text-subtle-foreground",
            )}
            aria-hidden
          />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {crew.name}
              </span>
              <LivenessDot liveness={crew.liveness} />
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {crew.status}
            </span>
          </span>
        </NavLink>
      </div>
    </li>
  );
}

/**
 * How a verdict reads at a glance. `DISAGREEMENT` is deliberately loud: the
 * instrument refuses to pick a winner when its signals conflict, and a row that
 * quietly rendered it as "unknown" would hide the most interesting agent on the
 * screen. No verdict at all draws nothing — absent is not idle.
 */
const LIVENESS_TONE: Record<string, string> = {
  working: "bg-success",
  tasked: "bg-success/60",
  stalled: "bg-warning-text",
  orphaned: "bg-warning-text",
  DISAGREEMENT: "bg-destructive-text",
  dead: "bg-subtle-foreground",
  finished: "bg-subtle-foreground",
};

function LivenessDot({ liveness }: { liveness: AgentLiveness | null }) {
  if (!liveness) return null;
  const tone = LIVENESS_TONE[liveness.verdict] ?? "bg-subtle-foreground";
  return (
    <span
      role="img"
      aria-label={liveness.verdict}
      className={cn("size-1.5 shrink-0 rounded-full", tone)}
    />
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
interface ProjectGroup {
  projectId: string;
  /** Null while the name has not arrived — never a stand-in string. */
  name: string | null;
  crews: Crew[];
}

/**
 * Crews under the project they belong to, which is the tree's real root: a
 * project is a folder someone chose, and its agents live inside it.
 *
 * Grouping needs only the id the crew already carries, so it never waits on
 * the name query. A group whose name has not arrived renders its crews with no
 * header rather than a placeholder — an unnamed project is a name we do not
 * have yet, and inventing one is how a sidebar starts lying.
 */
function groupByProject(
  crews: readonly Crew[],
  nameOf: ReadonlyMap<string, string>,
  projectIds: readonly string[],
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();

  // Seed from the PROJECT list, not from the crews. A project is a folder
  // someone chose; it exists the moment they choose it, and every project is
  // crewless at birth. Deriving the band from crews alone meant a brand new
  // project rendered nowhere — the operator picked a folder, the server created
  // it, and the sidebar showed him nothing.
  for (const projectId of projectIds) {
    groups.set(projectId, {
      projectId,
      name: nameOf.get(projectId) ?? null,
      crews: [],
    });
  }

  for (const crew of crews) {
    const existing = groups.get(crew.projectId);
    if (existing) {
      existing.crews.push(crew);
      continue;
    }
    groups.set(crew.projectId, {
      projectId: crew.projectId,
      name: nameOf.get(crew.projectId) ?? null,
      crews: [crew],
    });
  }
  // Real projects first and alphabetical. Personal sinks below them — an agent
  // tree belongs in Projects wherever it lives, but the projectless bucket is
  // not a folder anyone chose, so it does not compete for the top. Anything
  // still unnamed sits last rather than jumping around as names land.
  const weightOf = (group: ProjectGroup): number => {
    if (group.name === null) return 2;
    return group.projectId === PERSONAL_PROJECT_ID ? 1 : 0;
  };
  return [...groups.values()]
    .filter(
      // Personal is the projectless bucket, not a folder anyone chose. It earns
      // a row when it holds crews and stays out of the way when it does not —
      // an empty "Personal" folder invites you to fill something that is not a
      // place.
      (group) =>
        group.projectId !== PERSONAL_PROJECT_ID || group.crews.length > 0,
    )
    .sort((a, b) => {
      const byWeight = weightOf(a) - weightOf(b);
      if (byWeight !== 0) return byWeight;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
}

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
  const projectNameOf = useProjectNames();
  const projectIds = useMemo(() => [...projectNameOf.keys()], [projectNameOf]);
  const { createCrew, creating: creatingCrew } = useCreateCrew();

  return (
    <div className="flex flex-col px-2 pb-2 group-data-[collapsible=icon]:hidden">
      <div className="mb-1 mt-3 flex items-center justify-between gap-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS}>Projects</span>
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
          No projects yet — create one above.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groupByProject(crews, projectNameOf, projectIds).map((group) => (
            <li key={group.projectId}>
              {group.name === null ? null : (
                <div className="flex min-h-6 items-center gap-1.5 px-2">
                  <Icon
                    name="Folder"
                    className="size-3.5 shrink-0 text-subtle-foreground"
                    aria-hidden
                  />
                  <span className="truncate text-xs font-medium text-muted-foreground">
                    {group.name}
                  </span>
                </div>
              )}
              {group.crews.length === 0 ? (
                <button
                  type="button"
                  onClick={() => createCrew(group.projectId)}
                  disabled={creatingCrew}
                  className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-subtle-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50"
                >
                  <Icon name="Plus" className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate text-[13px]">
                    {creatingCrew ? "Standing up a crew…" : "Add a crew"}
                  </span>
                </button>
              ) : (
                <ul className="flex flex-col gap-1">
                  {group.crews.map((crew) => (
                    <CrewEntry
                      key={crew.commanderThreadId}
                      crew={crew}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Chats — the threads nobody has crewed, below the projects.
 *
 * Deliberately flat and quiet: a chat has no tree, and the section exists so a
 * conversation is never something you have to go digging in a drawer for.
 */
export function ChatsSidebarSection({
  onNavigate,
  onNewChat,
}: {
  onNavigate?: () => void;
  /** Starts a plain conversation. Absent when the surface cannot start one. */
  onNewChat?: () => void;
}) {
  const { chats, loaded } = useCrews();

  return (
    <div className="flex flex-col px-2 pb-2 group-data-[collapsible=icon]:hidden">
      <div className="mb-1 mt-3 flex items-center justify-between gap-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS}>Chats</span>
        {onNewChat ? (
          <button
            type="button"
            aria-label="New chat"
            onClick={onNewChat}
            className="grid size-5 shrink-0 place-items-center rounded text-subtle-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Icon name="Plus" className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {!loaded ? (
        // Silent while unknown: an empty Chats list and a Chats list that has
        // not arrived look identical, and only one of them is true.
        <p className="px-2 py-1 text-xs italic text-muted-foreground">
          Reading your chats…
        </p>
      ) : chats.length === 0 ? (
        <p className="px-2 py-1 text-xs italic text-muted-foreground">
          No chats yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {chats.map((chat) => (
            <li key={chat.threadId}>
              <NavLink
                to={getThreadRoutePath({
                  projectId: chat.projectId,
                  threadId: chat.threadId,
                })}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex h-7 min-w-0 items-center gap-2 rounded-md px-2 transition-colors",
                    isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
                  )
                }
              >
                <Icon
                  name="MessageSquare"
                  className="size-3.5 shrink-0 text-subtle-foreground"
                  aria-hidden
                />
                <span className="truncate text-[13px] text-foreground">
                  {chat.name}
                </span>
                <LivenessDot liveness={chat.liveness} />
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CrewSidebarSection;
