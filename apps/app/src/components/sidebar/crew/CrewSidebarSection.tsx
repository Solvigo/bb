import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { NavLink } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
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
  type LooseChat,
} from "./useCrews";
export { NewCrewButton } from "./NewCrewButton";
export { NewProjectButton } from "./NewProjectButton";

export const SIDEBAR_SECTION_LABEL_CLASS =
  "px-2 text-xs font-medium text-muted-foreground";

function CrewEntry({
  crew,
  onNavigate,
}: {
  crew: Crew;
  onNavigate?: () => void;
}) {
  const { editing, beginDrag, endDrag, justMovedId } =
    useContext(CrewEditContext);
  const drop = useAgentDrop({ agentId: crew.commanderThreadId });
  const anyWorking = crew.leads.some((l) => l.working);
  const justMoved = justMovedId === crew.commanderThreadId;
  // A commander is an agent like any other — it can be moved under another
  // agent, and the menu only needs the shape, not the class.
  const movable: MovableAgent = {
    threadId: crew.commanderThreadId,
    name: crew.name,
    sorties: crew.leads,
  };
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
          onClick={(event) => {
            // In edit mode a row is a handle, not a link.
            if (editing) event.preventDefault();
            else onNavigate?.();
          }}
          draggable={editing}
          onDragStart={(event) => {
            event.dataTransfer.setData(AGENT_DRAG_TYPE, crew.commanderThreadId);
            event.dataTransfer.effectAllowed = "move";
            setAgentDragImage(event.dataTransfer, crew.name);
            beginDrag(movable);
          }}
          onDragEnd={endDrag}
          {...drop.handlers}
          className={({ isActive }) =>
            cn(
              "flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
              // Where the agent would land, said loudly enough to see.
              drop.isOver && "bg-primary/20 ring-2 ring-inset ring-primary",
              drop.isForbidden && "cursor-not-allowed opacity-40",
              justMoved && "bg-primary/25 ring-2 ring-inset ring-primary/70",
            )
          }
        >
          {editing ? (
            <Icon
              name="DragDropVertical"
              className="size-3 shrink-0 text-subtle-foreground"
              aria-hidden
            />
          ) : null}
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
        {editing ? <AgentMoveMenu agent={movable} /> : null}
      </div>
      {crew.leads.length === 0 ? null : (
        <ul className="flex flex-col">
          {crew.leads.map((lead, index) => (
            <AgentTreeRow
              key={lead.threadId}
              agent={lead}
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

/**
 * What the whole tree needs to know while an agent is in the air.
 *
 * A row cannot answer "may I be dropped on?" alone: the answer depends on which
 * agent is being carried and what is inside its own branch. So the drag is
 * hoisted to the section and every row reads from here.
 */
interface CrewEditState {
  /** The agent currently being dragged, or null when nothing is. */
  draggingId: string | null;
  /** Every id inside the dragged agent's branch, itself included. */
  draggingSubtree: ReadonlySet<string>;
  beginDrag: (agent: MovableAgent) => void;
  endDrag: () => void;
  /** Edit mode: grips out, drop zones shown, navigation held back. */
  editing: boolean;
  announce: (message: string) => void;
  /** A refusal the operator should read, not just hear. */
  reportRefusal: (message: string) => void;
  /**
   * Every agent in the fleet, flat and in tree order, so a row can offer
   * "move under" without knowing the shape above it.
   */
  destinations: readonly AgentDestination[];
  /**
   * The one place a move happens. The drag and the menu are two ways to ask
   * for the same thing; if they each did their own reparent they would drift,
   * and only one of them would report a refusal.
   */
  move: (movingId: string, newParentId: string | null) => void;
  /**
   * The agent that just landed. A reparent redraws the tree in one frame and
   * the operator, still looking at where the row USED to be, sees nothing
   * happen; the row flashes at its new home so the eye is told where to go.
   */
  justMovedId: string | null;
  setEditing: (on: boolean | ((was: boolean) => boolean)) => void;
  /** The last refusal, still on screen. */
  refusal: string | null;
  /** What to say in the live region. */
  moveMessage: string;
}

/** One possible new parent, with enough depth to read as a tree in a menu. */
interface AgentDestination {
  threadId: string;
  name: string;
  depth: number;
}

const CrewEditContext = createContext<CrewEditState>({
  draggingId: null,
  draggingSubtree: new Set<string>(),
  beginDrag: () => {},
  endDrag: () => {},
  editing: false,
  announce: () => {},
  reportRefusal: () => {},
  destinations: [],
  move: () => {},
  justMovedId: null,
  setEditing: () => {},
  refusal: null,
  moveMessage: "",
});

/** Every id in an agent's branch, so a drop onto its own descendant is refused
 *  before the server has to say no. */
type MovableAgent = Pick<CrewLead, "threadId" | "name" | "sorties">;

function subtreeIds(agent: MovableAgent): Set<string> {
  const ids = new Set<string>([agent.threadId]);
  const walk = (node: MovableAgent): void => {
    for (const child of node.sorties) {
      ids.add(child.threadId);
      walk(child);
    }
  };
  walk(agent);
  return ids;
}

/**
 * What the cursor carries while an agent is being dragged.
 *
 * The default ghost is a slice of the sidebar — a translucent smear of the row
 * you grabbed. The operator dragged an agent and reported seeing nothing at
 * all, so the cursor now carries a small card with the agent's name on it,
 * wearing the composer's own background and border.
 */
function setAgentDragImage(dataTransfer: DataTransfer, name: string): void {
  if (typeof document === "undefined") return;
  const card = document.createElement("div");
  card.textContent = name;
  card.style.cssText = [
    "position:fixed",
    "top:-1000px",
    "left:-1000px",
    "max-width:220px",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "white-space:nowrap",
    "padding:6px 10px",
    "border-radius:10px",
    "font:500 12px/1.2 system-ui,sans-serif",
    "background:#1f1f1e",
    "border:1px solid #2c2c2b",
    "color:#e7e7e7",
    "box-shadow:0 6px 16px rgba(0,0,0,0.45)",
  ].join(";");
  document.body.appendChild(card);
  dataTransfer.setDragImage(card, 14, 14);
  requestAnimationFrame(() => card.remove());
}

/**
 * Whether the cursor is carrying an agent.
 *
 * `types` is all a drop target may look at while the drag is in the air: the
 * drag data store is in PROTECTED mode during dragenter/dragover, so getData()
 * returns "" no matter what was set. Asking for the id here — which is what
 * this code did — read null on every dragover, so no target ever called
 * preventDefault, so Chrome never delivered a drop and the whole gesture died
 * silently. The id is read on drop, and only on drop.
 */
function carriesAgent(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && dataTransfer.types.includes(AGENT_DRAG_TYPE);
}

function readAgentDrag(dataTransfer: DataTransfer | null): string | null {
  if (dataTransfer === null || !carriesAgent(dataTransfer)) return null;
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
function useAgentDrop(args: { agentId: string }): {
  isOver: boolean;
  /** A drag is in the air and this row cannot take it. */
  isForbidden: boolean;
  handlers: {
    onDragEnter: (event: React.DragEvent) => void;
    onDragOver: (event: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: React.DragEvent) => void;
  };
} {
  const { agentId } = args;
  const { draggingId, draggingSubtree, endDrag, move } =
    useContext(CrewEditContext);
  const [isOver, setIsOver] = useState(false);
  // An agent cannot be dropped on itself or on anything inside its own branch.
  // Saying so DURING the drag is the point: the server would refuse it anyway,
  // and a cursor that only finds out on release taught the operator nothing.
  const isForbidden = draggingId !== null && draggingSubtree.has(agentId);
  return {
    isOver: isOver && !isForbidden,
    isForbidden,
    handlers: {
      onDragEnter: (event) => {
        if (!carriesAgent(event.dataTransfer)) return;
        event.preventDefault();
        if (isForbidden) return;
        setIsOver(true);
      },
      onDragOver: (event) => {
        if (!carriesAgent(event.dataTransfer)) return;
        event.preventDefault();
        if (isForbidden) {
          event.dataTransfer.dropEffect = "none";
          return;
        }
        event.dataTransfer.dropEffect = "move";
        setIsOver(true);
      },
      onDragLeave: () => setIsOver(false),
      onDrop: (event) => {
        setIsOver(false);
        endDrag();
        const moving = readAgentDrag(event.dataTransfer);
        if (moving === null || isForbidden) return;
        event.preventDefault();
        event.stopPropagation();
        move(moving, agentId === "" ? null : agentId);
      },
    },
  };
}

/**
 * The edit state, owned above BOTH sidebar sections.
 *
 * It has to live here rather than inside the crew tree, because promoting an
 * agent to the root can move it OUT of that tree: a root with nothing under it
 * is not a crew, so it renders down in Chats. Owned by the crew section, the
 * grips and the move menu went with it and the agent was stranded — moved
 * somewhere the UI offered no way back from. Chats are agent threads like any
 * other, so they share the mode.
 */
export function CrewEditProvider({ children }: { children: ReactNode }) {
  const { crews } = useCrews();
  // What just happened to a dragged agent, said out loud. A move that only
  // shows as a row sliding is a move a screen reader never reports.
  const [moveMessage, setMoveMessage] = useState("");
  const announce = useCallback((message: string) => {
    setMoveMessage(message);
  }, []);
  // A refusal the operator can READ. The live region tells a screen reader; a
  // row springing back tells a sighted operator nothing about why.
  const [refusal, setRefusal] = useState<string | null>(null);
  const reportRefusal = useCallback((message: string) => {
    setRefusal(message);
    window.setTimeout(() => setRefusal(null), 6000);
  }, []);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<{
    id: string;
    subtree: ReadonlySet<string>;
  } | null>(null);
  const beginDrag = useCallback((agent: MovableAgent) => {
    setDragging({ id: agent.threadId, subtree: subtreeIds(agent) });
  }, []);
  const endDrag = useCallback(() => setDragging(null), []);
  // Esc leaves the mode, because a mode you cannot back out of is a trap.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);
  // Every agent, flat and in tree order, so the move menu can name a
  // destination the operator would otherwise have to drag to.
  const destinations = useMemo(() => {
    const out: AgentDestination[] = [];
    const walk = (agent: CrewLead, depth: number): void => {
      out.push({ threadId: agent.threadId, name: agent.name, depth });
      for (const child of agent.sorties) walk(child, depth + 1);
    };
    for (const crew of crews) {
      out.push({
        threadId: crew.commanderThreadId,
        name: crew.name,
        depth: 0,
      });
      for (const lead of crew.leads) walk(lead, 1);
    }
    return out;
  }, [crews]);

  const [justMovedId, setJustMovedId] = useState<string | null>(null);
  const move = useCallback(
    (movingId: string, newParentId: string | null) => {
      void reparentAgent(movingId, newParentId).then((outcome) => {
        if (outcome.ok) {
          announce(newParentId === null ? "Moved to the top." : "Moved.");
          setJustMovedId(movingId);
          window.setTimeout(
            () => setJustMovedId((id) => (id === movingId ? null : id)),
            900,
          );
          return;
        }
        const why = reparentRefusalText(outcome);
        announce(`Not moved — ${why}.`);
        reportRefusal(why);
      });
    },
    [announce, reportRefusal],
  );

  const editState = useMemo(
    () => ({
      draggingId: dragging?.id ?? null,
      draggingSubtree: dragging?.subtree ?? new Set<string>(),
      beginDrag,
      endDrag,
      editing,
      announce,
      reportRefusal,
      destinations,
      move,
      justMovedId,
    }),
    [
      announce,
      beginDrag,
      destinations,
      dragging,
      editing,
      endDrag,
      justMovedId,
      move,
      reportRefusal,
    ],
  );

  const value = useMemo(
    () => ({ ...editState, setEditing, refusal, moveMessage }),
    [editState, moveMessage, refusal],
  );
  return (
    <CrewEditContext.Provider value={value}>
      {children}
    </CrewEditContext.Provider>
  );
}

/**
 * The project header, doubling as the one place you can drop an agent to make
 * it a root.
 *
 * Promoting an agent to the top is the move with no row to aim at — every other
 * destination is an agent you can see. Without a target the operator drags
 * upward, finds nothing under the cursor, and concludes the feature is broken;
 * so the header lights up like any other target, and says what it is while a
 * drag is in the air.
 */
function ProjectRootDropZone({
  name,
  variant = "inline",
}: {
  name: string;
  /** Block header sits inside a project card; inline is the legacy row style. */
  variant?: "inline" | "block-header";
}) {
  const { draggingId } = useContext(CrewEditContext);
  const drop = useAgentDrop({ agentId: "" });
  const armed = draggingId !== null;
  const isBlockHeader = variant === "block-header";
  return (
    <div
      {...drop.handlers}
      className={cn(
        "flex items-center gap-2 transition-colors",
        isBlockHeader ? "min-h-7 px-0" : "min-h-6 gap-1.5 rounded px-2",
        armed && "ring-1 ring-inset ring-border",
        drop.isOver && "bg-primary/20 ring-2 ring-primary",
      )}
    >
      <Icon
        name="Folder"
        className={cn(
          "shrink-0 text-subtle-foreground",
          isBlockHeader ? "size-4" : "size-3.5",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "truncate font-medium",
          isBlockHeader
            ? "text-sm text-foreground"
            : "text-xs text-muted-foreground",
        )}
      >
        {name}
      </span>
      {armed ? (
        <span className="ml-auto shrink-0 text-[10px] text-subtle-foreground">
          drop to make root
        </span>
      ) : null}
    </div>
  );
}

/**
 * The no-drag path.
 *
 * Drag is the fast way to move an agent and the only way some people will never
 * manage it — a trackpad, a long list that scrolls under the cursor, a hand
 * that does not hold a button steady. Every move the drag can make is here too,
 * as a list you can read.
 */
function AgentMoveMenu({
  agent,
  className,
}: {
  agent: MovableAgent;
  className?: string;
}) {
  const { destinations, move } = useContext(CrewEditContext);
  const forbidden = useMemo(() => subtreeIds(agent), [agent]);
  const targets = destinations.filter((d) => !forbidden.has(d.threadId));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Move ${agent.name}`}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded text-subtle-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
            className,
          )}
        >
          <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 w-56 overflow-y-auto"
      >
        <DropdownMenuLabel className="truncate">{`Move ${agent.name}`}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => move(agent.threadId, null)}>
          Make root
        </DropdownMenuItem>
        {targets.length === 0 ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-subtle-foreground">
              Move under…
            </DropdownMenuLabel>
            {targets.map((target) => (
              <DropdownMenuItem
                key={target.threadId}
                onSelect={() => move(agent.threadId, target.threadId)}
              >
                <span
                  className="truncate"
                  style={{ paddingLeft: `${target.depth * 10}px` }}
                >
                  {target.name}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  depth,
  isLast,
  onNavigate,
  projectId,
}: {
  agent: CrewLead;
  depth: number;
  /** Last child of its parent, so the guide rail can stop rather than dangle. */
  isLast: boolean;
  onNavigate?: () => void;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = agent.sorties.length > 0;
  const { editing, beginDrag, endDrag, move, justMovedId } =
    useContext(CrewEditContext);
  const drop = useAgentDrop({ agentId: agent.threadId });
  const justMoved = justMovedId === agent.threadId;

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
            setAgentDragImage(event.dataTransfer, agent.name);
            beginDrag(agent);
          }}
          onDragEnd={endDrag}
          // In edit mode a click edits, it does not travel. Navigating away
          // mid-rearrangement loses the shape you were halfway through.
          onClickCapture={(event) => {
            if (!editing) return;
            event.preventDefault();
            event.stopPropagation();
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
            move(agent.threadId, null);
          }}
          className={({ isActive }) =>
            cn(
              "flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors",
              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
              drop.isOver && "bg-primary/20 ring-2 ring-inset ring-primary",
              drop.isForbidden && "cursor-not-allowed opacity-40",
              justMoved && "bg-primary/25 ring-2 ring-inset ring-primary/70",
            )
          }
        >
          {editing ? (
            <Icon
              name="DragDropVertical"
              className="size-3 shrink-0 text-subtle-foreground"
              aria-hidden
            />
          ) : null}
          <span className="truncate text-[13px] text-foreground">
            {agent.name}
          </span>
          <LivenessDot liveness={agent.liveness} />
          <AttentionBadge count={agent.attention} name={agent.name} />
        </NavLink>
        {editing ? <AgentMoveMenu agent={agent} /> : null}
      </div>
      {hasChildren && expanded ? (
        <ul className="flex flex-col">
          {agent.sorties.map((sortie, index) => (
            <AgentTreeRow
              key={sortie.threadId}
              agent={sortie}
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
  const { editing, setEditing, refusal, moveMessage } =
    useContext(CrewEditContext);
  return (
    <div className="flex flex-col px-2 pb-2 group-data-[collapsible=icon]:hidden">
      <div className="mb-1 mt-3 flex items-center justify-between gap-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS}>Projects</span>
        {/* The discoverable way in. Dragging still works without it, but a
            gesture nobody can see is not a feature anybody has. */}
        <button
          type="button"
          aria-pressed={editing}
          aria-label={editing ? "Done editing the crew" : "Edit the crew"}
          onClick={() => setEditing((on) => !on)}
          className={cn(
            "ml-auto grid size-5 shrink-0 place-items-center rounded transition-colors",
            editing
              ? "bg-sidebar-accent text-foreground"
              : "text-subtle-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <Icon
            name={editing ? "Check" : "Edit"}
            className="size-3.5"
            aria-hidden
          />
        </button>
        {headerTrailing}
      </div>
      {editing ? (
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">
          Drag an agent onto another to move it under it, or onto a project to
          make it a root. Esc when you are done.
        </p>
      ) : null}
      {refusal !== null ? (
        // The reason, where the operator is already looking.
        <p
          role="alert"
          data-testid="crew-move-refusal"
          className="mx-2 mb-1 rounded-md border border-destructive-text/40 px-2 py-1 text-[11px] text-destructive-text"
        >
          {`Not moved — ${refusal}.`}
        </p>
      ) : null}
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
        <ul className="flex flex-col gap-3">
          {groupByProject(crews, projectNameOf, projectIds).map((group) => (
            <li key={group.projectId} data-testid="sidebar-project-group">
              <div className="overflow-hidden rounded-lg border border-sidebar-border bg-surface-recessed-solid">
                {group.name === null ? null : (
                  <div className="border-b border-sidebar-border px-2.5 py-2">
                    <ProjectRootDropZone
                      name={group.name}
                      variant="block-header"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1 px-1.5 py-2">
                  {group.crews.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => createCrew(group.projectId)}
                      disabled={creatingCrew}
                      className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-subtle-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50"
                    >
                      <Icon
                        name="Plus"
                        className="size-3.5 shrink-0"
                        aria-hidden
                      />
                      <span className="truncate text-sm">
                        {creatingCrew ? "Standing up a crew…" : "Add a crew"}
                      </span>
                    </button>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {group.crews.map((crew) => (
                        <CrewEntry
                          key={crew.commanderThreadId}
                          crew={crew}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One loose chat — an agent with nothing under it and nothing above it.
 *
 * It carries the full edit-mode kit rather than a bare link, because this is
 * where an agent LANDS when it is promoted to the root: a root with no branch
 * is not a crew, so it renders here. Without a grip and a menu of its own,
 * "make root" was a one-way door.
 */
function ChatRow({
  chat,
  onNavigate,
}: {
  chat: LooseChat;
  onNavigate?: () => void;
}) {
  const { editing, beginDrag, endDrag, justMovedId } =
    useContext(CrewEditContext);
  const movable: MovableAgent = {
    threadId: chat.threadId,
    name: chat.name,
    sorties: [],
  };
  return (
    <li>
      <div className="flex items-center">
        <NavLink
          to={getThreadRoutePath({
            projectId: chat.projectId,
            threadId: chat.threadId,
          })}
          onClick={(event) => {
            if (editing) event.preventDefault();
            else onNavigate?.();
          }}
          // A chat is an agent that nothing reports to yet, so it can be
          // picked up like any other. Drag one onto an agent and it stops
          // being loose — it moves out of here and into that branch.
          //
          // It is a source and not a destination: the crew plugin refuses a
          // childless root as a parent ("Parent thread is invalid"), so
          // offering it as a target would only ever produce a refusal.
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(AGENT_DRAG_TYPE, chat.threadId);
            event.dataTransfer.effectAllowed = "move";
            setAgentDragImage(event.dataTransfer, chat.name);
            beginDrag(movable);
          }}
          onDragEnd={endDrag}
          className={({ isActive }) =>
            cn(
              "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 transition-colors",
              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
              justMovedId === chat.threadId &&
                "bg-primary/25 ring-2 ring-inset ring-primary/70",
            )
          }
        >
          {editing ? (
            <Icon
              name="DragDropVertical"
              className="size-3 shrink-0 text-subtle-foreground"
              aria-hidden
            />
          ) : null}
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
        {editing ? <AgentMoveMenu agent={movable} /> : null}
      </div>
    </li>
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
            <ChatRow key={chat.threadId} chat={chat} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default CrewSidebarSection;
