import { useCallback, useMemo, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getThreadRoutePath } from "@/lib/route-paths";
import { useProjectNames } from "@/hooks/queries/sidebar-navigation-query";
import { useCreateCrew } from "./useCreateCrew";
import {
  reparentAgent,
  reparentRefusalText,
  useCrews,
  type AgentLiveness,
  type Crew,
  type CrewLead,
} from "./useCrews";
export { NewCrewButton } from "./NewCrewButton";

export const SIDEBAR_SECTION_LABEL_CLASS =
  "px-2 text-xs font-medium text-muted-foreground";

function CrewEntry({
  announce,
  crew,
  onNavigate,
}: {
  announce: (message: string) => void;
  crew: Crew;
  onNavigate?: () => void;
}) {
  const drop = useAgentDrop({ agentId: crew.commanderThreadId, announce });
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
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(AGENT_DRAG_TYPE, crew.commanderThreadId);
            event.dataTransfer.effectAllowed = "move";
          }}
          {...drop.handlers}
          className={({ isActive }) =>
            cn(
              "flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
              drop.isOver && "ring-1 ring-inset ring-primary",
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
              <AttentionBadge count={crew.attention} name={crew.name} />
            </span>
            {crew.leads.length === 0 ? (
              // Only worth a line when there is no tree to read instead. With
              // leads on screen, "4 leads standing by" restates what the rows
              // below it already say.
              <span className="truncate text-xs text-muted-foreground">
                {crew.status}
              </span>
            ) : null}
          </span>
        </NavLink>
      </div>
      {crew.leads.length === 0 ? null : (
        <ul className="flex flex-col">
          {crew.leads.map((lead, index) => (
            <AgentTreeRow
              key={lead.threadId}
              agent={lead}
              announce={announce}
              depth={1}
              isLast={index === crew.leads.length - 1}
              onNavigate={onNavigate}
              projectId={crew.projectId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The drag payload: which agent is being moved. */
const AGENT_DRAG_TYPE = "application/x-bb-agent";

function readAgentDrag(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null;
  if (!dataTransfer.types.includes(AGENT_DRAG_TYPE)) return null;
  const id = dataTransfer.getData(AGENT_DRAG_TYPE).trim();
  return id === "" ? null : id;
}

/**
 * Everything a row needs to be both a thing you can pick up and a place you can
 * drop one, kept in a single hook so a row and a root row cannot drift apart.
 *
 * `announce` is not decoration: a drag is invisible to a screen reader, and a
 * refusal that only shows as a row springing back is a refusal nobody heard.
 */
function useAgentDrop(args: {
  agentId: string;
  announce: (message: string) => void;
}): {
  isOver: boolean;
  handlers: {
    onDragOver: (event: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: React.DragEvent) => void;
  };
} {
  const { agentId, announce } = args;
  const [isOver, setIsOver] = useState(false);
  return {
    isOver,
    handlers: {
      onDragOver: (event) => {
        const moving = readAgentDrag(event.dataTransfer);
        if (moving === null || moving === agentId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setIsOver(true);
      },
      onDragLeave: () => setIsOver(false),
      onDrop: (event) => {
        setIsOver(false);
        const moving = readAgentDrag(event.dataTransfer);
        if (moving === null || moving === agentId) return;
        event.preventDefault();
        event.stopPropagation();
        void reparentAgent(moving, agentId === "" ? null : agentId).then(
          (outcome) => {
            announce(
              outcome.ok
                ? "Moved."
                : `Not moved — ${reparentRefusalText(outcome)}.`,
            );
          },
        );
      },
    },
  };
}

/**
 * One agent in the crew tree, and whatever reports to it.
 *
 * The sidebar answers "where can I go", so every agent is a destination and the
 * org chart lives here rather than in the render area. Depth is unbounded on
 * purpose — the thread tree has no limit, and an agent that exists and is not
 * shown is the one outcome an agent tree may not have.
 *
 * Sorties start COLLAPSED: a lead is worth seeing whenever its project is open,
 * but a deep fleet expanded by default floods the rail and buries the projects
 * underneath it.
 */
function AgentTreeRow({
  agent,
  announce,
  depth,
  isLast,
  onNavigate,
  projectId,
}: {
  announce: (message: string) => void;
  agent: CrewLead;
  depth: number;
  /** Last child of its parent, so the guide rail can stop rather than dangle. */
  isLast: boolean;
  onNavigate?: () => void;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = agent.sorties.length > 0;
  const drop = useAgentDrop({ agentId: agent.threadId, announce });

  return (
    <li>
      <div
        className="relative flex min-w-0 items-center"
        // Indentation is computed from depth rather than a fixed class per
        // level, because the tree is as deep as the fleet is.
        //
        // It is 22px and not the 12 it started at. Twelve was indentation you
        // could MEASURE and not indentation you could SEE: against the padding
        // the rows already carry, three leads under a pilot read as one flat
        // list of four, which is exactly what the operator reported. The guide
        // line below does the other half of the work — the eye follows a line
        // where it will not follow whitespace.
        style={{ paddingLeft: `${depth * 22}px` }}
      >
        {/* One rail per level, each marking the branch its row hangs off. It
            stops at the row's middle on the last child so the line ends where
            the tree does instead of running into open space. */}
        {Array.from({ length: depth }, (_, level) => (
          <span
            key={level}
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-0 w-px bg-tower-border",
              level === depth - 1 && isLast ? "h-1/2" : "h-full",
            )}
            style={{ left: `${level * 22 + 10}px` }}
          />
        ))}
        {/* The elbow into this row, drawn only for the level it belongs to. */}
        <span
          aria-hidden
          className="pointer-events-none absolute h-px w-2 bg-tower-border"
          style={{ left: `${(depth - 1) * 22 + 10}px`, top: "50%" }}
        />
        {hasChildren ? (
          <button
            type="button"
            aria-label={
              expanded
                ? `Hide the agents under ${agent.name}`
                : `Show the agents under ${agent.name}`
            }
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground transition-colors hover:text-foreground"
          >
            <Icon
              name={expanded ? "ChevronDown" : "ChevronRight"}
              className="size-3.5"
              aria-hidden
            />
          </button>
        ) : (
          // The rows still have to line up when a leaf sits beside a parent.
          <span className="size-5 shrink-0" aria-hidden />
        )}
        <NavLink
          to={getThreadRoutePath({ projectId, threadId: agent.threadId })}
          onClick={onNavigate}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(AGENT_DRAG_TYPE, agent.threadId);
            event.dataTransfer.effectAllowed = "move";
          }}
          {...drop.handlers}
          // The keyboard route to the same move. A drag is a mouse gesture and
          // reparenting must not be mouse-only: this promotes an agent to the
          // root, which is the one move that cannot be reached by dropping on
          // something else when the row you want is off screen.
          onKeyDown={(event) => {
            if (event.key !== "Backspace" && event.key !== "Delete") return;
            if (!event.shiftKey) return;
            event.preventDefault();
            void reparentAgent(agent.threadId, null).then((outcome) => {
              announce(
                outcome.ok
                  ? `${agent.name} moved to the top.`
                  : `Not moved — ${reparentRefusalText(outcome)}.`,
              );
            });
          }}
          className={({ isActive }) =>
            cn(
              "flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors",
              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
              drop.isOver && "ring-1 ring-inset ring-primary",
            )
          }
        >
          <span className="truncate text-[13px] text-foreground">
            {agent.name}
          </span>
          <LivenessDot liveness={agent.liveness} />
          <AttentionBadge count={agent.attention} name={agent.name} />
        </NavLink>
      </div>
      {hasChildren && expanded ? (
        <ul className="flex flex-col">
          {agent.sorties.map((sortie, index) => (
            <AgentTreeRow
              key={sortie.threadId}
              agent={sortie}
              announce={announce}
              depth={depth + 1}
              isLast={index === agent.sorties.length - 1}
              onNavigate={onNavigate}
              projectId={projectId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * How many things are waiting on the Captain here, counting everything below.
 *
 * It clears when the item is ACTED on — approved, answered, decided — and never
 * on merely opening the agent. A badge that cleared on view would teach him
 * that looking is the same as dealing with it, which is exactly the habit that
 * loses an ask.
 */
function AttentionBadge({ count, name }: { count: number; name: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} item${count === 1 ? "" : "s"} waiting on you under ${name}`}
      className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive-text px-1 text-[10px] font-medium leading-none text-background"
    >
      {count > 99 ? "99+" : count}
    </span>
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
  // What just happened to a dragged agent, said out loud. A move that only
  // shows as a row sliding is a move a screen reader never reports.
  const [moveMessage, setMoveMessage] = useState("");
  const announce = useCallback((message: string) => {
    setMoveMessage(message);
  }, []);

  return (
    <div className="flex flex-col px-2 pb-2 group-data-[collapsible=icon]:hidden">
      <div className="mb-1 mt-3 flex items-center justify-between gap-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS}>Projects</span>
        {headerTrailing}
      </div>
      {/* Politely, so a completed or refused move announces itself without
          interrupting. A drag is invisible to a screen reader, and a refusal
          that shows only as a row springing back is a refusal nobody heard. */}
      <p className="sr-only" role="status" aria-live="polite">
        {moveMessage}
      </p>
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
                <div
                  className="flex min-h-6 items-center gap-1.5 rounded px-2"
                  // Dropping an agent on its project makes it a root — the one
                  // move that has no row to aim at.
                  onDragOver={(event) => {
                    if (readAgentDrag(event.dataTransfer) === null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    const moving = readAgentDrag(event.dataTransfer);
                    if (moving === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    void reparentAgent(moving, null).then((outcome) => {
                      announce(
                        outcome.ok
                          ? "Moved to the top."
                          : `Not moved — ${reparentRefusalText(outcome)}.`,
                      );
                    });
                  }}
                >
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
                      announce={announce}
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
                // A chat is an agent that nothing reports to yet, so it can be
                // picked up like any other. Drag one onto an agent and it stops
                // being loose — it moves out of here and into that branch.
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(AGENT_DRAG_TYPE, chat.threadId);
                  event.dataTransfer.effectAllowed = "move";
                }}
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
