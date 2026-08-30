import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  type PendingRoot,
} from "./useCrews";
export { NewCrewButton } from "./NewCrewButton";

export const SIDEBAR_SECTION_LABEL_CLASS =
  "px-2 text-xs font-medium text-muted-foreground";

// Three row types share one visual vocabulary: the row you are on, the row a
// drag is hovering, and the row that just arrived. Naming each state once is
// what keeps the three rows looking like one list.
const ROW_RESTING_CLASS = "hover:bg-sidebar-accent";
const ROW_CURRENT_CLASS = "bg-sidebar-accent";
const ROW_DROP_TARGET_CLASS = "bg-primary/20 ring-2 ring-inset ring-primary";
const ROW_JUST_MOVED_CLASS = "bg-primary/25 ring-2 ring-inset ring-primary/70";
// The one control a project card offers when it has no crew: add one, or
// finish the one whose charter did not go through. Same row either way.
const CARD_ACTION_CLASS =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-subtle-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50";

function CrewEntry({
  crew,
  onNavigate,
}: {
  crew: Crew;
  onNavigate?: () => void;
}) {
  const {
    editingCrewId,
    setEditingCrewId,
    beginDrag,
    endDrag,
    justMovedId,
    recoverableIds,
    registerRearrangeButton,
  } = useContext(CrewEditContext);
  const editing = editingCrewId === crew.commanderThreadId;
  // A different crew is being edited. Dimmed by the ancestor's
  // pointer-events-none below, but that only stops the mouse — a click
  // arriving through retained or programmatic focus still reaches the
  // handler, so the handler has to refuse it itself.
  const outOfScope = editingCrewId !== null && !editing;
  // A crew a leaf was JUST promoted into: `assembleFleet` classifies a
  // promoted agent by whether it carries a crew handle, and a normal
  // crew-spawned lead always does — so it comes back as a brand new root
  // CREW with no leads, not a loose chat. Without this it would render as
  // any other out-of-scope crew: dimmed, inert, and offering no way back.
  // Every crew promoted this session is independently recoverable, not just
  // the most recently settled one.
  const isRecoverable =
    editingCrewId !== null && recoverableIds.has(crew.commanderThreadId);
  // Not useInEditScope(): this component renders the CrewScopeContext
  // Provider below, so a hook called up here — before that provider exists —
  // would read the ambient value from OUTSIDE this crew, which is never this
  // crew's own id. `editing` is the same fact, computed directly.
  const drop = useAgentDrop({
    agentId: crew.commanderThreadId,
    inScope: editing,
  });
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
    <CrewScopeContext.Provider value={crew.commanderThreadId}>
      <li
        className={cn(
          "transition-opacity",
          // Editing one crew dims the rest, so the operator can see the boundary
          // of what they are rearranging rather than inferring it. Skipped for
          // the recoverable crew specifically: dimming here is pointer-events-
          // none on the WHOLE row, which would take the move-menu button below
          // down with it — that button is the one thing this row still has to
          // offer.
          outOfScope && !isRecoverable && "pointer-events-none opacity-40",
        )}
      >
        <div className="group/crew flex items-center">
          <NavLink
            to={threadPath(crew.commanderThreadId)}
            onClick={(event) => {
              // A crew dimmed for someone else's edit session is inert, not
              // just quiet — it must not navigate even if it kept focus from
              // before that session began.
              if (outOfScope) {
                event.preventDefault();
                return;
              }
              // In edit mode a row is a handle, not a link.
              if (editing) event.preventDefault();
              else onNavigate?.();
            }}
            aria-disabled={outOfScope || undefined}
            draggable={editing}
            // Guarded the same way the drop side is: draggable={editing} is
            // what a mouse honors, but a dispatched dragstart does not check
            // the attribute, so the handler refuses on its own too.
            onDragStart={(event) => {
              if (!editing) {
                event.preventDefault();
                return;
              }
              startAgentDrag(event, movable, beginDrag);
            }}
            onDragEnd={endDrag}
            // Dimmed for every crew but the one being edited; pointer-events
            // stops the mouse but not Tab, so keyboard focus is pulled too.
            tabIndex={outOfScope ? -1 : undefined}
            {...drop.handlers}
            className={({ isActive }) =>
              cn(
                "flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
                isActive ? ROW_CURRENT_CLASS : ROW_RESTING_CLASS,
                // The recoverable row's own dimming, since the ancestor's is
                // skipped for it — this link stays inert even though the
                // move-menu button beside it does not.
                outOfScope && isRecoverable && "pointer-events-none opacity-40",
                // Where the agent would land, said loudly enough to see.
                drop.isOver && ROW_DROP_TARGET_CLASS,
                drop.isForbidden && "cursor-not-allowed opacity-40",
                justMoved && ROW_JUST_MOVED_CLASS,
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
          {editing || isRecoverable ? (
            <AgentMoveMenu agent={movable} />
          ) : null}
          {editingCrewId === null ? (
            // Where edit mode is entered: on the crew it will act on, not on a
            // global switch that arms the whole rail.
            <button
              type="button"
              aria-label={`Rearrange ${crew.name}`}
              // Registered so Done/Escape can hand focus back to THIS crew's
              // own button once the edit bar unmounts and this one remounts
              // — otherwise focus drops to the document body the instant the
              // control it was on (Done) disappears.
              ref={(el) => registerRearrangeButton(crew.commanderThreadId, el)}
              onClick={(event) => {
                event.preventDefault();
                setEditingCrewId(crew.commanderThreadId);
              }}
              className="grid size-5 shrink-0 place-items-center rounded text-subtle-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 group-hover/crew:opacity-100"
            >
              <Icon name="Edit" className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        {crew.leads.length === 0 ? null : (
          <ul className="flex flex-col">
            {crew.leads.map((lead, index) => (
              <Fragment key={lead.threadId}>
                <InsertionZone parentId={crew.commanderThreadId} />
                <AgentTreeRow
                  agent={lead}
                  depth={1}
                  isLast={index === crew.leads.length - 1}
                  onNavigate={onNavigate}
                  projectId={crew.projectId}
                />
              </Fragment>
            ))}
            <InsertionZone parentId={crew.commanderThreadId} />
          </ul>
        )}
      </li>
    </CrewScopeContext.Provider>
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
  /**
   * The crew being edited, by its commander's thread id, or null when none is.
   *
   * Scoped to ONE crew on purpose. Edit mode used to arm the whole rail at
   * once: every agent and every loose chat grew a grip, so the operator was
   * offered a hundred moves when they wanted one, and the surrounding tree
   * gave no clue which part of it they were rearranging.
   */
  editingCrewId: string | null;
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
  setEditingCrewId: (crewId: string | null) => void;
  /** The last refusal, still on screen. */
  refusal: string | null;
  /** What to say in the live region. */
  moveMessage: string;
  /**
   * Every thread promoted out of the crew being edited THIS session, still
   * waiting for a move back in.
   *
   * A normal crew-spawned leaf keeps its crew handle across the promotion, so
   * `assembleFleet` renders it as a brand new root CREW with no leads, not a
   * loose chat — a handle-less thread is the rarer case that actually becomes
   * one. Either shape checks this the same way: by thread id. A single "last
   * one" slot made every promotion but the most recently SETTLED one a
   * one-way door — a second promotion made the first unrecoverable the
   * instant its own network reply landed, not because the operator did
   * anything to it. Every promotion this session stays recoverable
   * independently until it is either moved back (removed on its own) or the
   * session ends (the whole set clears): unrelated roots are never in it.
   * Only ever ADDED from the resolution of the reparent call that caused it,
   * and only if that edit session is still the current one when it resolves
   * — a Done or a switch to a different crew before the network answers must
   * not let a stale promise plant a recovery in whatever session is running
   * when it finally lands.
   */
  recoverableIds: ReadonlySet<string>;
  /**
   * Registers a crew's "Rearrange" button so focus can return to it after
   * Done/Escape unmounts the edit bar and remounts this button — without it,
   * the browser drops focus to the document body the moment the focused
   * control (Done, wherever the operator left it) disappears.
   */
  registerRearrangeButton: (crewId: string, el: HTMLButtonElement | null) => void;
  /**
   * Registers the "Done" button so entering edit mode can move focus onto it
   * — the "Rearrange" button the operator just clicked unmounts the instant
   * editingCrewId is set, and a click target that vanishes out from under
   * focus is exactly the same lost-focus problem as leaving edit mode.
   */
  registerDoneButton: (el: HTMLButtonElement | null) => void;
  /**
   * Registers the deterministic fallback focus target — the "Projects"
   * heading itself — for when the crew being left has disappeared or
   * reclassified out from under its own commander thread id: there is no
   * "that crew's Rearrange button" to hand focus back to, and the browser's
   * default (dropping it to the document body) is not a landing anyone
   * asked for.
   */
  registerFallbackFocusTarget: (el: HTMLElement | null) => void;
}

/**
 * The crew a row belongs to, so any row at any depth can answer "am I part of
 * the crew being edited?" without threading the answer down by hand.
 */
const CrewScopeContext = createContext<string | null>(null);

/** True when this row is inside the crew currently being edited. */
function useInEditScope(): boolean {
  const { editingCrewId } = useContext(CrewEditContext);
  const crewId = useContext(CrewScopeContext);
  return editingCrewId !== null && crewId === editingCrewId;
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
  editingCrewId: null,
  announce: () => {},
  reportRefusal: () => {},
  destinations: [],
  move: () => {},
  justMovedId: null,
  setEditingCrewId: () => {},
  refusal: null,
  moveMessage: "",
  recoverableIds: new Set<string>(),
  registerRearrangeButton: () => {},
  registerDoneButton: () => {},
  registerFallbackFocusTarget: () => {},
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

function findInLeads(
  leads: readonly CrewLead[],
  id: string,
): CrewLead | null {
  for (const lead of leads) {
    if (lead.threadId === id) return lead;
    const found = findInLeads(lead.sorties, id);
    if (found) return found;
  }
  return null;
}

/**
 * An agent's CURRENT node in the live tree, or null when it is not part of
 * any crew right now (a genuine loose chat, or gone entirely).
 *
 * `draggingSubtree`, by contrast, is a snapshot taken at `beginDrag` time — it
 * answers "what was under this agent when the drag started", which is exactly
 * the wrong question when the fleet has refreshed since: a target that moved
 * INTO the dragged agent's branch after the drag began would not show up
 * there, and a move-time cycle check needs the branch as it is now.
 */
function findCurrentNode(
  crews: readonly Crew[],
  id: string,
): MovableAgent | null {
  for (const crew of crews) {
    if (crew.commanderThreadId === id) {
      return { threadId: crew.commanderThreadId, name: crew.name, sorties: crew.leads };
    }
    const found = findInLeads(crew.leads, id);
    if (found) return found;
  }
  return null;
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
  card.className = "agent-drag-card";
  card.textContent = name;
  document.body.appendChild(card);
  dataTransfer.setDragImage(card, 14, 14);
  requestAnimationFrame(() => card.remove());
}

/**
 * Everything a row does when it is picked up. Three rows start an agent drag
 * and all three have to set the same payload, effect and cursor card; keeping
 * one copy is what stops them drifting apart.
 */
function startAgentDrag(
  event: React.DragEvent,
  agent: MovableAgent,
  beginDrag: (agent: MovableAgent) => void,
): void {
  event.dataTransfer.setData(AGENT_DRAG_TYPE, agent.threadId);
  event.dataTransfer.effectAllowed = "move";
  setAgentDragImage(event.dataTransfer, agent.name);
  beginDrag(agent);
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
function useAgentDrop(args: { agentId: string; inScope: boolean }): {
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
  const { agentId, inScope } = args;
  const { draggingId, draggingSubtree, endDrag, move, editingCrewId } =
    useContext(CrewEditContext);
  const [isOver, setIsOver] = useState(false);
  // An agent cannot be dropped on itself or on anything inside its own branch,
  // nor onto a target outside the scope the caller has computed for it (a row
  // outside the crew being edited, or a project header that isn't the edited
  // crew's own). `inScope` is passed in rather than read from context here,
  // because a row that OWNS a CrewScopeContext provider — the commander row —
  // renders that provider below itself; reading the context in the same hook
  // call would see the ambient value from OUTSIDE the crew, never its own.
  // The row that owns the drop already dims and disables pointer events for
  // out-of-scope targets, but that is presentation, not the guarantee: the
  // handler refuses the drop itself so a bypassed or future style change
  // cannot reopen the hole.
  const isForbidden =
    draggingId !== null && (draggingSubtree.has(agentId) || !inScope);
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
        // The id on the dataTransfer is whatever the drop site claims it is —
        // a loose chat, a row from another crew, or a stale payload from a
        // drag that already ended can all claim to be it. `draggingId` is our
        // own state, set only when a row's guarded onDragStart actually ran,
        // so it is the one source of truth for what is legitimately in the
        // air. A mismatch means the claimed source was never a real drag.
        if (
          moving === null ||
          moving !== draggingId ||
          isForbidden ||
          editingCrewId === null
        ) {
          return;
        }
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
  const [editingCrewId, setEditingCrewIdState] = useState<string | null>(null);
  // The recovery set is good for ONE edit session — every entry in it was
  // promoted out of THAT session's crew, so the set itself needs no per-entry
  // record of which crew. Bumped every time the session changes — entering,
  // leaving, or switching crews — so an async reparent's `.then()` can tell,
  // when it finally resolves, whether the session that started it is still
  // the one running. A stale resolution must not plant a recovery in
  // whatever session happens to be current.
  const editSessionRef = useRef(0);
  const [recoverableIds, setRecoverableIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The session generation catches a stale move landing in the WRONG
  // session; it says nothing about two moves of the SAME thread landing out
  // of order in the SAME one. Recover a thread (pending), then — before that
  // reply lands — an optimistic refresh shows it back under its crew and the
  // operator promotes it again: if the re-promotion's reply arrives first and
  // the stale recovery arrives after, the recovery's "it moved back in, drop
  // it from the set" would erase the re-promotion's fresher "it left again,
  // add it" the instant it landed. Each thread gets its own counter, bumped
  // on every move() call for it; a `.then()` only touches recoverableIds if
  // its own call is still the latest one issued for that thread.
  //
  // Cleared on every session transition, same as recoverableIds — the
  // session generation already rejects any completion from a session that
  // has ended, so entries here can never affect anything past that point.
  // Keeping them anyway would just grow this map by one dead thread id for
  // every promotion ever made, for as long as the provider — which spans the
  // whole sidebar's lifetime — stays mounted.
  const threadOperationGenerationRef = useRef(new Map<string, number>());
  const setEditingCrewId = useCallback((crewId: string | null) => {
    editSessionRef.current += 1;
    setRecoverableIds(new Set());
    threadOperationGenerationRef.current.clear();
    setEditingCrewIdState(crewId);
  }, []);
  const [dragging, setDragging] = useState<{
    id: string;
    subtree: ReadonlySet<string>;
  } | null>(null);
  const beginDrag = useCallback((agent: MovableAgent) => {
    setDragging({ id: agent.threadId, subtree: subtreeIds(agent) });
  }, []);
  const endDrag = useCallback(() => setDragging(null), []);
  // Esc leaves the mode, because a mode you cannot back out of is a trap. It
  // also ends any drag in flight — otherwise the drag survives the mode that
  // armed it, and drop.isForbidden being computed from a stale draggingId
  // paints a row as an active target for a drag that no longer has anywhere
  // legal to land.
  useEffect(() => {
    if (editingCrewId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      endDrag();
      setEditingCrewId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingCrewId, endDrag, setEditingCrewId]);
  // Every agent, flat and in tree order, so the move menu can name a
  // destination the operator would otherwise have to drag to.
  const destinations = useMemo(() => {
    const out: AgentDestination[] = [];
    const walk = (agent: CrewLead, depth: number): void => {
      out.push({ threadId: agent.threadId, name: agent.name, depth });
      for (const child of agent.sorties) walk(child, depth + 1);
    };
    for (const crew of crews) {
      if (editingCrewId !== null && crew.commanderThreadId !== editingCrewId) {
        continue;
      }
      out.push({
        threadId: crew.commanderThreadId,
        name: crew.name,
        depth: 0,
      });
      for (const lead of crew.leads) walk(lead, 1);
    }
    return out;
  }, [crews, editingCrewId]);

  const [justMovedId, setJustMovedId] = useState<string | null>(null);
  const refuseStaleSource = useCallback(() => {
    reportRefusal(reparentRefusalText({ ok: false, reason: "unknown-agent" }));
  }, [reportRefusal]);
  const move = useCallback(
    (movingId: string, newParentId: string | null) => {
      // `destinations` and `recoverableIds` are both live — recomputed
      // whenever the fetched fleet or the edit session changes — so this is
      // membership as of NOW, not as of whenever a drag started or a menu
      // opened. draggingId/dataTransfer only prove a drag was real when it
      // began; they say nothing about whether the fleet still agrees the
      // source belongs where the caller thinks it does. A background refresh
      // that reparented or removed it mid-drag must not let a stale drop or a
      // stale menu selection through.
      const crewMemberIds = new Set(destinations.map((d) => d.threadId));
      const isRecoveredSource = recoverableIds.has(movingId);
      if (
        editingCrewId === null ||
        (!crewMemberIds.has(movingId) && !isRecoveredSource)
      ) {
        refuseStaleSource();
        return;
      }
      // The target is read fresh from the row/menu that called `move`, which
      // itself renders from current data — except a menu selection can be
      // stale if the destination it named has, in the meantime, been removed
      // or refreshed away, or if the fleet moved it INSIDE movingId's own
      // branch, which the drag-time subtree check (a snapshot from when the
      // drag began) has no way to know about. Checked here, once, for both
      // drag and menu callers.
      if (newParentId !== null) {
        if (!crewMemberIds.has(newParentId)) {
          refuseStaleSource();
          return;
        }
        const movingNode = findCurrentNode(crews, movingId);
        if (movingNode !== null && subtreeIds(movingNode).has(newParentId)) {
          reportRefusal(reparentRefusalText({ ok: false, reason: "cycle" }));
          return;
        }
      }
      const promotingCrewMember =
        newParentId === null && crewMemberIds.has(movingId);
      // Captured now, not read fresh inside `.then()`: the whole point is to
      // compare the session THIS call started under against whatever is
      // current when the network answers.
      const sessionAtCallTime = editSessionRef.current;
      // Same idea, scoped to this ONE thread rather than the whole session:
      // bumped on every move() call for `movingId`, so a `.then()` can tell
      // whether some LATER move of the SAME thread has already been issued
      // and, if so, defer to whatever that one decides instead.
      const threadGeneration =
        (threadOperationGenerationRef.current.get(movingId) ?? 0) + 1;
      threadOperationGenerationRef.current.set(movingId, threadGeneration);
      void reparentAgent(movingId, newParentId).then((outcome) => {
        if (outcome.ok) {
          announce(newParentId === null ? "Moved to the top." : "Moved.");
          setJustMovedId(movingId);
          window.setTimeout(
            () => setJustMovedId((id) => (id === movingId ? null : id)),
            900,
          );
          const isLatestForThread =
            threadOperationGenerationRef.current.get(movingId) ===
            threadGeneration;
          if (
            editSessionRef.current === sessionAtCallTime &&
            isLatestForThread
          ) {
            if (promotingCrewMember) {
              // A crew member just left the crew being edited — however
              // assembleFleet ends up classifying it, this is the one
              // recovery path back in. The functional updater matters: two
              // promotions can each hold their OWN stale closure over
              // recoverableIds, and whichever settles second must not
              // silently drop the first's addition by rebuilding the set
              // from an outdated snapshot.
              setRecoverableIds((prev) => {
                const next = new Set(prev);
                next.add(movingId);
                return next;
              });
            } else if (newParentId !== null && isRecoveredSource) {
              // The recovered thread just moved back into a crew; it is no
              // longer stranded, so it comes out of the set on its own —
              // every OTHER thread still promoted this session stays exactly
              // as recoverable as it was.
              setRecoverableIds((prev) => {
                if (!prev.has(movingId)) return prev;
                const next = new Set(prev);
                next.delete(movingId);
                return next;
              });
            }
          }
          return;
        }
        const why = reparentRefusalText(outcome);
        announce(`Not moved — ${why}.`);
        reportRefusal(why);
      });
    },
    [
      announce,
      crews,
      destinations,
      editingCrewId,
      recoverableIds,
      refuseStaleSource,
      reportRefusal,
    ],
  );

  // Focus follows the mode, not just the data. Entering edit mode unmounts
  // the exact button the operator's focus was on (every "Rearrange" affords
  // only while editingCrewId is null); leaving it unmounts Done and remounts
  // every "Rearrange" button, INCLUDING the one for the crew just edited.
  // Neither transition is a re-render the browser can carry focus through on
  // its own — the focused element is gone, so focus drops to the document
  // body unless something claims it.
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const registerDoneButton = useCallback((el: HTMLButtonElement | null) => {
    doneButtonRef.current = el;
  }, []);
  const rearrangeButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const registerRearrangeButton = useCallback(
    (crewId: string, el: HTMLButtonElement | null) => {
      if (el) rearrangeButtonsRef.current.set(crewId, el);
      else rearrangeButtonsRef.current.delete(crewId);
    },
    [],
  );
  // The deterministic fallback for when there is no specific control left to
  // hand focus to — the crew being left disappeared or reclassified out from
  // under its own commander thread id (a promotion, a deletion, a merge
  // elsewhere) between entering edit mode and leaving it, so rearrangeId has
  // no button registered under `previous` any more. The "Projects" heading
  // always exists regardless of what happened to any one crew, which is the
  // only property this fallback actually needs.
  const fallbackFocusTargetRef = useRef<HTMLElement | null>(null);
  const registerFallbackFocusTarget = useCallback((el: HTMLElement | null) => {
    fallbackFocusTargetRef.current = el;
  }, []);
  const previousEditingCrewIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousEditingCrewIdRef.current;
    previousEditingCrewIdRef.current = editingCrewId;
    if (editingCrewId !== null && previous === null) {
      // The clicked Rearrange button just unmounted under the operator's
      // focus; Done is the one control guaranteed to exist in its place.
      (doneButtonRef.current ?? fallbackFocusTargetRef.current)?.focus();
    } else if (editingCrewId === null && previous !== null) {
      // Done just unmounted; that crew's OWN Rearrange button just
      // remounted in its place — unless the crew itself is gone, in which
      // case fall back rather than leave focus to drop to the document body.
      (
        rearrangeButtonsRef.current.get(previous) ??
        fallbackFocusTargetRef.current
      )?.focus();
    }
  }, [editingCrewId]);

  const editState = useMemo(
    () => ({
      draggingId: dragging?.id ?? null,
      draggingSubtree: dragging?.subtree ?? new Set<string>(),
      beginDrag,
      endDrag,
      editingCrewId,
      announce,
      reportRefusal,
      destinations,
      move,
      justMovedId,
      recoverableIds,
      registerRearrangeButton,
      registerDoneButton,
      registerFallbackFocusTarget,
    }),
    [
      announce,
      beginDrag,
      destinations,
      dragging,
      editingCrewId,
      endDrag,
      justMovedId,
      move,
      recoverableIds,
      registerDoneButton,
      registerFallbackFocusTarget,
      registerRearrangeButton,
      reportRefusal,
    ],
  );

  const value = useMemo(
    () => ({ ...editState, setEditingCrewId, refusal, moveMessage }),
    [editState, moveMessage, refusal, setEditingCrewId],
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
 *
 * `reparentAgent` takes no project — a root is a root, not a root OF a
 * project — so only the header for the project the edited crew actually
 * lives in may accept the drop. Every other project's header would perform
 * the exact same "make root" whichever one you dropped it on, which is not
 * what dropping it on THAT header implies.
 */
function ProjectRootDropZone({
  name,
  projectId,
  inScope,
}: {
  name: string;
  projectId: string;
  inScope: boolean;
}) {
  const { draggingId, editingCrewId } = useContext(CrewEditContext);
  const drop = useAgentDrop({ agentId: "", inScope });
  const armed = draggingId !== null && inScope;
  const dimmed = editingCrewId !== null && !inScope;
  return (
    <div
      {...drop.handlers}
      data-testid={`project-root-drop-${projectId}`}
      data-project-drop-active={armed ? "true" : "false"}
      className={cn(
        "flex min-h-7 items-center gap-2 px-0 transition-colors",
        armed && "ring-1 ring-inset ring-border",
        drop.isOver && "bg-primary/20 ring-2 ring-primary",
        dimmed && "pointer-events-none opacity-40",
      )}
    >
      <Icon
        name="Folder"
        className="size-4 shrink-0 text-subtle-foreground"
        aria-hidden
      />
      <span className="truncate text-sm font-medium text-foreground">
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
 * The gap between two rows, as a place you can drop.
 *
 * A row is a 28px target and the operator has to hit the RIGHT one; the whole
 * complaint about this mode being hard to use is that everything worth aiming
 * at was small. A gap says "put it here, alongside these" — which in a tree
 * whose only structure is a parent pointer means "give it the same parent" —
 * and it can be made as large as it needs to be, because a gap costs nothing
 * when nothing is being dragged.
 */
function InsertionZone({ parentId }: { parentId: string | null }) {
  const { draggingId, draggingSubtree, endDrag, move, editingCrewId } =
    useContext(CrewEditContext);
  const inScope = useInEditScope();
  const [isOver, setIsOver] = useState(false);
  const armed = draggingId !== null && inScope;
  const isForbidden =
    draggingId !== null && parentId !== null && draggingSubtree.has(parentId);
  if (!armed) return null;
  return (
    <div
      aria-hidden
      onDragEnter={(event) => {
        if (!carriesAgent(event.dataTransfer)) return;
        event.preventDefault();
        if (isForbidden) return;
        setIsOver(true);
      }}
      onDragOver={(event) => {
        if (!carriesAgent(event.dataTransfer)) return;
        event.preventDefault();
        if (isForbidden) {
          event.dataTransfer.dropEffect = "none";
          return;
        }
        event.dataTransfer.dropEffect = "move";
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(event) => {
        setIsOver(false);
        // Same as the row/project drop targets: a drop ends the drag whether
        // or not it is accepted. This one had been skipping that, so a
        // refused (or even an accepted) gap drop could leave draggingId set —
        // the next crew entered for editing would inherit a drag nobody was
        // still holding.
        endDrag();
        const moving = readAgentDrag(event.dataTransfer);
        // Same cross-check as the row drop target: the dataTransfer's claimed
        // id is untrusted, `draggingId` (set only by a guarded onDragStart)
        // is not.
        if (
          moving === null ||
          moving !== draggingId ||
          isForbidden ||
          editingCrewId === null
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        move(moving, parentId);
      }}
      className={cn(
        "relative -my-1 flex h-4 items-center py-1.5",
        isForbidden && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cn(
          "h-0.5 w-full rounded-full transition-colors",
          isOver && !isForbidden ? "bg-primary" : "bg-transparent",
        )}
      />
    </div>
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
  const { beginDrag, endDrag, move, justMovedId, draggingId, editingCrewId } =
    useContext(CrewEditContext);
  const editing = useInEditScope();
  // Dimmed by the enclosing crew's opacity/pointer-events, but Tab does not
  // honor either — a keyboard user could still land here and fire the Shift
  // shortcut below. Pulling it out of the tab order is the real fix.
  const outOfScope = editingCrewId !== null && !editing;
  const drop = useAgentDrop({ agentId: agent.threadId, inScope: editing });
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
            onClick={() => {
              // Same guard as `disabled` below, redundantly: a real <button>
              // being disabled is the platform's own guarantee, but the
              // handler refuses on its own too rather than depend on exactly
              // how a given runtime dispatches a click to a disabled control.
              if (outOfScope) return;
              setExpanded((open) => !open);
            }}
            disabled={outOfScope}
            className="flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground transition-colors hover:text-foreground disabled:pointer-events-none"
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
          draggable={editing}
          // Guarded the same way the drop side is: draggable={editing} is
          // what a mouse honors, but a dispatched dragstart does not check
          // the attribute, so the handler refuses on its own too.
          onDragStart={(event) => {
            if (!editing) {
              event.preventDefault();
              return;
            }
            startAgentDrag(event, agent, beginDrag);
          }}
          onDragEnd={endDrag}
          // In edit mode a click edits, it does not travel — and dimmed for a
          // DIFFERENT crew's edit, it must not travel either, or a click that
          // arrives through retained or programmatic focus (pointer-events on
          // the ancestor only ever stopped the mouse) navigates a row that
          // looks disabled.
          onClickCapture={(event) => {
            if (!editing && !outOfScope) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          aria-disabled={outOfScope || undefined}
          tabIndex={outOfScope ? -1 : undefined}
          {...drop.handlers}
          // The keyboard route to the same move. A drag is a mouse gesture and
          // reparenting must not be mouse-only: this promotes an agent to the
          // root, which is the one move that cannot be reached by dropping on
          // something else when the row you want is off screen. Gated to the
          // crew in scope, the same as the drag itself — otherwise a row dimmed
          // for a different crew still moved on Shift+Delete.
          onKeyDown={(event) => {
            if (!editing) return;
            if (event.key !== "Backspace" && event.key !== "Delete") return;
            if (!event.shiftKey) return;
            event.preventDefault();
            move(agent.threadId, null);
          }}
          className={({ isActive }) =>
            cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left transition-all",
              // A row grows while something is in the air: the target the
              // operator has to hit is the thing they said was hard to use.
              draggingId !== null ? "min-h-9 py-2" : "min-h-7 py-0.5",
              isActive ? ROW_CURRENT_CLASS : ROW_RESTING_CLASS,
              drop.isOver && ROW_DROP_TARGET_CLASS,
              drop.isForbidden && "cursor-not-allowed opacity-40",
              justMoved && ROW_JUST_MOVED_CLASS,
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
            <Fragment key={sortie.threadId}>
              <InsertionZone parentId={agent.threadId} />
              <AgentTreeRow
                agent={sortie}
                depth={depth + 1}
                isLast={index === agent.sorties.length - 1}
                onNavigate={onNavigate}
                projectId={projectId}
              />
            </Fragment>
          ))}
          <InsertionZone parentId={agent.threadId} />
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
 * Whether a project already has a CREW.
 *
 * Only a crew counts. An ordinary chat on a project is a conversation, not a
 * crew, and letting one stand in for a root meant a project the operator had
 * only ever talked in could never be given a crew at all — Add a crew simply
 * was not there, with nothing on screen to say why. An unchartered standby is
 * not counted here either; it renders its own retry.
 */
export function projectHasCrew(
  projectId: string,
  crews: readonly Crew[],
): boolean {
  return crews.some((c) => c.projectId === projectId);
}

/** The unchartered standby waiting on this project, if there is one. */
export function pendingRootOf(
  pendingRoots: readonly PendingRoot[],
  projectId: string,
): PendingRoot | null {
  return pendingRoots.find((r) => r.projectId === projectId) ?? null;
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
  const { crews, chats, pendingRoots, loaded, failed, timedOut, reload } =
    useCrews();
  const projectNameOf = useProjectNames();
  const projectIds = useMemo(() => [...projectNameOf.keys()], [projectNameOf]);
  const projectGroups = useMemo(
    () => groupByProject(crews, projectNameOf, projectIds),
    [crews, projectNameOf, projectIds],
  );
  const {
    createCrew,
    creatingFor: creatingCrewFor,
    error: createCrewError,
  } = useCreateCrew();
  const {
    editingCrewId,
    setEditingCrewId,
    endDrag,
    refusal,
    moveMessage,
    registerDoneButton,
    registerFallbackFocusTarget,
  } = useContext(CrewEditContext);
  const editingCrew = crews.find(
    (crew) => crew.commanderThreadId === editingCrewId,
  );
  const editingCrewName = editingCrew?.name ?? null;
  // reparentAgent takes no project, so "make root" is not scoped to a
  // project the operator picks — it lands wherever the edited crew already
  // lives. Only that one project's header may act as the drop target.
  const editingProjectId = editingCrew?.projectId ?? null;
  return (
    <div className="flex flex-col px-2 pb-2 group-data-[collapsible=icon]:hidden">
      <div className="mb-1 mt-3 flex items-center justify-between gap-2">
        <span
          // The deterministic fallback focus target: the crew being left can
          // disappear or reclassify out from under its own Rearrange button,
          // and this heading is the one thing in the section guaranteed to
          // still be there. A real heading role (not a generic div) so a
          // screen reader announces where focus landed, not just that it
          // moved; tabIndex takes it out of ordinary Tab order — it is a
          // landing spot for a mode change, not a stop on the way through
          // the sidebar — while still making it a legal focus() target; the
          // ring gives it a visible landing a sighted keyboard user can see,
          // regardless of how focus arrived here.
          ref={registerFallbackFocusTarget}
          role="heading"
          aria-level={2}
          tabIndex={-1}
          className={cn(
            SIDEBAR_SECTION_LABEL_CLASS,
            "rounded focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
          )}
        >
          Projects
        </span>
        {headerTrailing}
      </div>
      {editingCrewId !== null ? (
        // A MODE has to announce itself. The old hint was a grey paragraph
        // under the heading, which is indistinguishable from help text — the
        // operator could not tell the rail was armed, or what it was armed on.
        <div
          role="status"
          data-testid="crew-edit-bar"
          className="mb-2 flex flex-col gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5"
        >
          <div className="flex items-center gap-1.5">
            <Icon
              name="Edit"
              className="size-3.5 shrink-0 text-primary"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
              {`Editing ${editingCrewName ?? "this crew"}`}
            </span>
            <button
              type="button"
              // Registered so entering edit mode can move focus here — the
              // Rearrange button the operator just clicked unmounts the
              // instant editingCrewId is set, and Done is the one control
              // guaranteed to exist in its place.
              ref={registerDoneButton}
              onClick={() => {
                endDrag();
                setEditingCrewId(null);
              }}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15"
            >
              Done
            </button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Drag onto an agent to nest it, into a gap to make it a sibling, or
            onto the project to make it a root. Esc to finish.
          </p>
        </div>
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
      {createCrewError !== null ? (
        <p
          role="alert"
          data-testid="crew-create-error"
          className="mx-2 mb-1 rounded-md border border-destructive-text/40 px-2 py-1 text-[11px] text-destructive-text"
        >
          {createCrewError}
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
      ) : failed &&
        crews.length === 0 &&
        chats.length === 0 &&
        projectGroups.length === 0 ? (
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
      ) : projectGroups.length === 0 ? (
        <p className="px-2 py-1 text-xs italic text-muted-foreground">
          No projects yet — create one above.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {projectGroups.map((group) => {
            const projectInScope = group.projectId === editingProjectId;
            // Every other project goes inert during an edit session, same as
            // its header: an empty project's only affordance is standing up a
            // brand new crew, which has nothing to do with the crew being
            // rearranged and shouldn't be reachable mid-session.
            const projectOutOfScope = editingCrewId !== null && !projectInScope;
            // A standby whose charter did not go through stays HERE, inside
            // the project it was made for, carrying the retry. Sent to Chats
            // it read as a conversation and, by counting as the project's
            // root, hid the only control that could finish it.
            const pending =
              pendingRootOf(pendingRoots, group.projectId) !== null;
            // Per project: a crew standing up on one project is no reason for
            // another project's card to go dead.
            const busyHere = creatingCrewFor(group.projectId);
            const projectLabel = group.name ?? "this project";
            return (
              <li
              key={group.projectId}
              data-testid="sidebar-project-group"
              // The card is a group so its controls are announced under the
              // project they belong to rather than as a flat list of buttons.
              role="group"
              aria-label={projectLabel}
            >
                <div className="overflow-hidden rounded-lg border border-sidebar-border bg-surface-recessed-solid">
                  {group.name === null ? null : (
                    <div className="border-b border-sidebar-border px-2.5 py-2">
                      <ProjectRootDropZone
                        name={group.name}
                        projectId={group.projectId}
                        inScope={projectInScope}
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1 px-1.5 py-2">
                    {!projectHasCrew(group.projectId, crews) ? (
                      <button
                        type="button"
                        data-testid={
                          pending ? "retry-crew-button" : "add-crew-button"
                        }
                        // Named for its project. Every card carries a control
                        // reading "Add a crew", so the bare label told a screen
                        // reader which ACTION this was and never which project
                        // it would act on.
                        aria-label={
                          pending
                            ? `Retry the unfinished crew setup on ${projectLabel}`
                            : `Add a crew to ${projectLabel}`
                        }
                        onClick={() => {
                          if (projectOutOfScope) return;
                          createCrew(group.projectId);
                        }}
                        disabled={busyHere || projectOutOfScope}
                        className={cn(
                          CARD_ACTION_CLASS,
                          projectOutOfScope && "pointer-events-none opacity-40",
                        )}
                      >
                        <Icon
                          name={pending ? "RotateCcw" : "Plus"}
                          className="size-3.5 shrink-0"
                          aria-hidden
                        />
                        <span className="truncate text-sm">
                          {busyHere
                            ? "Standing up a crew…"
                            : pending
                              ? "Setup did not finish — retry"
                              : "Add a crew"}
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
            );
          })}
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
  const { editingCrewId, endDrag, justMovedId, recoverableIds } =
    useContext(CrewEditContext);
  // A loose chat belongs to no crew, so it is never part of the crew being
  // edited — and while one is being edited it steps out of the way entirely.
  const editing = false;
  const dimmed = editingCrewId !== null;
  // Dragging a chat is closed off entirely (see draggable={false} below), but
  // that must not be the only way back INTO a crew: a handle-less thread
  // promoted to root becomes exactly this row, and a chat with no drag and no
  // menu had no way to undo that short of the server-side move tooling. The
  // dropdown is a plain click calling `move` directly — no dataTransfer to
  // spoof — so it reopens a recovery path without reopening the drag hole.
  // Bound to whichever threads THIS edit session promoted, though: every
  // other loose chat, same project or not, has no crew affiliation to recover
  // into, and offering the menu there would just be a way to reparent an
  // unrelated thread by accident.
  const canMove = editingCrewId !== null && recoverableIds.has(chat.threadId);
  const movable: MovableAgent = {
    threadId: chat.threadId,
    name: chat.name,
    sorties: [],
  };
  return (
    <li className="transition-opacity">
      <div className="flex items-center">
        <NavLink
          to={getThreadRoutePath({
            projectId: chat.projectId,
            threadId: chat.threadId,
          })}
          onClick={(event) => {
            // Dimmed while any crew is being edited, and that must hold even
            // if the click arrives through focus the row kept from before
            // edit mode began — pointer-events-none on this same link stops
            // a mouse, never a keyboard activation on existing focus.
            if (dimmed) {
              event.preventDefault();
              return;
            }
            onNavigate?.();
          }}
          aria-disabled={dimmed || undefined}
          // A loose chat belongs to no crew, so it is never in scope for the
          // crew being edited. It used to stay draggable during edit mode,
          // relying on the dimmed ancestor's pointer-events-none to keep it
          // from actually being picked up — a style, not a guarantee. It is
          // not draggable during edit mode at all now.
          draggable={false}
          // Belt-and-suspenders alongside draggable={false}: a synthetic
          // dragstart does not honor the attribute, so the handler itself
          // refuses to hand out drag data.
          onDragStart={(event) => {
            event.preventDefault();
          }}
          onDragEnd={endDrag}
          // Dimming lives on the link itself, not an ancestor, because the
          // move-menu button beside it has to stay reachable — pointer-events
          // and Tab both, not just the pointer.
          tabIndex={dimmed ? -1 : undefined}
          className={({ isActive }) =>
            cn(
              "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 transition-colors",
              isActive ? ROW_CURRENT_CLASS : ROW_RESTING_CLASS,
              dimmed && "pointer-events-none opacity-40",
              justMovedId === chat.threadId && ROW_JUST_MOVED_CLASS,
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
        {canMove ? <AgentMoveMenu agent={movable} /> : null}
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
