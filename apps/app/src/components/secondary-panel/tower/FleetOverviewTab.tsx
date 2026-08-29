import {
  Component,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useAtomValue } from "jotai";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import { useCrewRpc } from "./useCrewRpc";
import { useLiveThreads } from "./useLiveThreads";
import { useSortieActivity } from "./useSortieActivity";
import { useItemTrail } from "./useItemTrail";
import { SpFocusView } from "./SpFocusView";
import { ageSince } from "@/lib/relative-time";
import { towerNavAtom } from "./towerNav";
import { useRouteState } from "@/hooks/useRouteState";
import { stripRankPrefix } from "@/lib/agent-title";
import { SecondaryPanelEmptyState } from "@/components/secondary-panel/SecondaryPanelEmptyState";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ariaLevelFor,
  elbowGeometry,
  ELBOW_TOP_PX,
  FAMILY_SPACING_CLASS,
  railIndentPx,
  railLeftPx,
  spacingBetween,
} from "./treeLayout";

// The 7 chain columns (states); verbs are the transitions between them.
const COLUMNS: { key: string; label: string; accent?: boolean }[] = [
  { key: "drafted", label: "Draft" },
  { key: "confirmed", label: "Confirmed" },
  { key: "queued", label: "Queued" },
  { key: "in_flight", label: "Working", accent: true },
  { key: "in_review", label: "Review" },
  { key: "pilot_look", label: "Approval" },
  { key: "clearance", label: "Ready", accent: true },
];
const COL_KEYS = new Set(COLUMNS.map((c) => c.key));
const TERMINAL_LABEL: Record<string, string> = {
  accepted: "approved",
  landed: "completed",
  done: "completed",
};

// Depth-scaled chrome: a root card carries the fleet's full weight, and every
// level below it steps down once. Depth beyond a lead's own sorties (depth
// 2+) shares the lightest step rather than fading indefinitely — past that
// point the rail and indent already carry the ancestry, and further fading
// would just make deep cards hard to read.
interface CardWeight {
  border: string;
  shadow: string;
  title: string;
  iconWrap: string;
  icon: string;
}
const CARD_WEIGHT: Record<"root" | "mid" | "deep", CardWeight> = {
  root: {
    border: "border-tower-border-strong",
    shadow: "shadow-sm",
    title: "text-base font-semibold",
    iconWrap: "size-9",
    icon: "size-4",
  },
  mid: {
    border: "border-tower-border",
    shadow: "",
    title: "text-sm font-semibold",
    iconWrap: "size-8",
    icon: "size-3.5",
  },
  deep: {
    border: "border-tower-border/70",
    shadow: "",
    title: "text-sm font-medium",
    iconWrap: "size-7",
    icon: "size-3",
  },
};
function cardWeightFor(depth: number): CardWeight {
  if (depth <= 0) return CARD_WEIGHT.root;
  if (depth === 1) return CARD_WEIGHT.mid;
  return CARD_WEIGHT.deep;
}

interface FleetRow {
  threadId: string;
  handle: string | null;
  parentThreadId: string | null;
  rank: string;
}
interface FleetResult {
  ok: boolean;
  rows: FleetRow[];
}
interface BoardRow {
  threadId: string;
  report: {
    rank: string;
    state: string;
    note: string;
    at: string;
    escalated: boolean;
  } | null;
}
interface BoardResult {
  ok: boolean;
  rows: BoardRow[];
}
interface WorkItem {
  taskId: string;
  attempts: {
    threadId: string;
    /** the sortie's own name — the agent actually flying this item */
    handle: string | null;
    /** the crew plugin's own verdict on whether this attempt is still alive */
    liveness: string | null;
  }[];
}
interface WorkBoardResult {
  ok: boolean;
  workItems: WorkItem[];
}
interface QueueItem {
  taskId: string;
  title: string;
  state: string;
  displayState: string | null;
  dispatchable: boolean;
  blockedBecause: string | null;
  /** the attempt this item is running on — absent until it is dispatched */
  lastAttempt: { threadId: string; state: string; at: string } | null;
}
/**
 * The de-minimis summary. Chore rows are STRIPPED from `items` by the store and
 * summarised here, so a board renders its real work exactly as before plus one
 * quiet line — the Captain's rationale is that chores must never crowd real
 * work, and a row per chore is precisely how they would.
 *
 * `null` means zero chores and renders nothing. `newestTitle` is already a
 * plain string and may be empty, so it is rendered degenerate-safe rather than
 * assumed to have content.
 */
interface ChoresSummary {
  count: number;
  newestTitle: string;
}

/** What the crew plugin says is still waiting on somebody. */
interface AttentionResult {
  open?: { threadId?: string | null; audience?: string | null }[];
}

interface QueueResult {
  ok: boolean;
  items: QueueItem[];
  /** Absent on a store that predates the field; null when there are no chores. */
  chores?: ChoresSummary | null;
}

interface PlacedItem {
  taskId: string;
  title: string;
  col: string; // a COLUMN key, "terminal", or "dropped"
  termLabel?: string;
  /** when this flight's current attempt began — null until it is dispatched */
  attemptAt: string | null;
  /** the crew plugin's liveness verdict for the attempt, when it has one */
  liveness: string | null;
  /** the thread this sortie runs on — null until a sortie is dispatched */
  attemptThreadId: string | null;
  /** the sortie flying this item; null when none has been dispatched yet */
  sortie: string | null;
  dispatchable: boolean;
  blockedBecause: string | null;
}

const UNASSIGNED = "__unassigned__";

// Honest buckets from chain state (v2 airline vocabulary):
const HOLD_COLS = new Set(["drafted", "confirmed", "queued"]); // waiting to launch
const HELD_COLS = new Set(["in_review", "pilot_look", "clearance"]); // held at a gate

/** An operator-facing agent name: the ranks are Commander, Lead and Sortie, so
 *  substrate prefixes (sp-, plt-, cm-) never reach a label. */
/**
 * What to call an agent on screen. The crew plugin's handle when it has one,
 * the agent's own thread title when it does not — and its id only if it has
 * neither, which should be unreachable. A raw id is substrate vocabulary: it
 * tells the operator nothing and it is what the drill-down header printed for a
 * lead the plugin had no handle for.
 */
function agentLabel(
  handle: string | null,
  title: string | undefined,
  threadId: string,
): string {
  const raw = handle ?? (title && title.length > 0 ? title : threadId);
  return leadName(raw);
}

function leadName(handle: string): string {
  return stripRankPrefix(handle);
}

/** A compact, stable task number derived from its id. */
function taskNumber(taskId: string): string {
  let h = 0;
  for (let i = 0; i < taskId.length; i++)
    h = (Math.imul(h, 31) + taskId.charCodeAt(i)) >>> 0;
  return `TASK-${100 + (h % 900)}`;
}

/** Compact "time since" (v2: "40s", "4m", "2h 20m", "1d 03h"). */
/** A task has lost contact when the crew plugin says its attempt is gone —
 *  its own verdict, never a guess from how long the card has been sitting. */
function hasLostContact(item: PlacedItem): boolean {
  return (
    item.col === "in_flight" &&
    (item.liveness === "dead-or-gone" || item.liveness === "dead")
  );
}

/** The task's operator-facing status, derived from its real queue state. */
function statusChip(
  item: PlacedItem,
): { label: string; silent: boolean } | null {
  if (item.col === "in_flight") {
    if (hasLostContact(item)) return { label: "disconnected", silent: true };
    return { label: "working", silent: false };
  }
  if (item.col === "queued") return { label: "queued", silent: false };
  if (item.col === "drafted" || item.col === "confirmed")
    return { label: "planned", silent: false };
  if (HELD_COLS.has(item.col))
    return { label: "awaiting review", silent: false };
  return null;
}

/** A task card with its worker, activity, status and on-demand history. */
function ItemTrail({ taskId }: { taskId: string }) {
  const { transitions, truncated, loaded } = useItemTrail(taskId);
  if (!loaded) {
    return (
      <div className="mt-1 px-1 font-tower-mono text-[8.5px] italic text-tower-fg-faint">
        reading the trail…
      </div>
    );
  }
  if (transitions.length === 0) {
    // A real answer, not a gap: an item that has not moved since the log
    // existed has no hops. Saying so beats drawing nothing.
    return (
      <div className="mt-1 px-1 font-tower-mono text-[8.5px] italic text-tower-fg-faint">
        no moves recorded
      </div>
    );
  }
  return (
    <ol className="mt-1 flex flex-col gap-1 px-1">
      {truncated ? (
        <li className="font-tower-mono text-[8px] italic text-tower-fg-faint">
          older moves not shown
        </li>
      ) : null}
      {transitions.map((hop, i) => (
        <li
          key={`${hop.at}-${i}`}
          className="flex min-w-0 items-baseline gap-1.5"
        >
          <span className="shrink-0 font-tower-mono text-[8px] text-tower-fg-faint">
            {hop.at.slice(11, 16)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-tower-mono text-[8.5px] text-tower-fg-body">
              {hop.fromState} → {hop.toState}
            </span>
            {hop.detail ? (
              <span className="ml-1 line-clamp-2 text-[9px] leading-snug text-tower-fg-muted">
                {hop.detail}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Card({ item }: { item: PlacedItem }) {
  const attemptAge = ageSince(item.attemptAt);
  const [trailOpen, setTrailOpen] = useState(false);
  const chip = statusChip(item);
  const silent = chip?.silent ?? false;
  // What this sortie is actually doing, straight from its own transcript.
  const activity = useSortieActivity(item.attemptThreadId);
  return (
    <div
      className={
        "mb-2 rounded-lg border px-3 py-2.5 " +
        (silent
          ? "border-tower-border bg-tower-panel"
          : "border-tower-border bg-tower-raised")
      }
      title={item.taskId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-tower-fg-muted">
          {taskNumber(item.taskId)}
          {/* the SORTIE flying this item — a lead never flies one itself */}
          {item.sortie ? (
            <span className="text-tower-fg-muted">
              {" "}
              · {leadName(item.sortie)}
            </span>
          ) : null}
        </span>
        {attemptAge ? (
          <span className="shrink-0 text-xs text-tower-fg-faint">
            {attemptAge}
          </span>
        ) : null}
      </div>
      <div
        className={
          "mt-1.5 line-clamp-2 text-sm font-medium leading-snug " +
          (silent ? "text-tower-fg-muted" : "text-tower-fg-body")
        }
      >
        {item.title}
      </div>
      {/* the sortie's last line of activity — its own transcript, live */}
      {activity ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-tower-border bg-tower-surface px-2.5 py-2">
          <span
            className={
              "mt-px shrink-0 text-xs font-medium " +
              (activity.working ? "text-tower-fg-body" : "text-tower-fg-faint")
            }
          >
            {activity.working ? "live" : "last"}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-relaxed text-tower-fg-muted">
            {activity.line}
          </span>
        </div>
      ) : null}
      {/* Its whole passage, on the item. Fetched only when ASKED for — a board
          of twenty cards must not open twenty reads to draw itself. */}
      <div className="mt-1.5">
        <button
          type="button"
          onClick={() => setTrailOpen((open) => !open)}
          aria-expanded={trailOpen}
          className="font-tower-mono text-[8px] uppercase tracking-[0.72px] text-tower-fg-faint transition-colors hover:text-tower-fg-body"
        >
          {trailOpen ? "▾ history" : "▸ history"}
        </button>
        {trailOpen ? <ItemTrail taskId={item.taskId} /> : null}
      </div>
      {!item.sortie && STAGE_OF[item.col] === "in_flight" ? (
        <div className="mt-1.5 font-tower-mono text-[8.5px] italic text-tower-fg-faint">
          no worker assigned
        </div>
      ) : null}
      {chip ? (
        <div className="mt-1.5 flex items-center justify-between gap-1.5">
          <span
            className={
              "truncate text-xs " +
              (silent ? "text-tower-fg-muted" : "text-tower-fg-faint")
            }
          >
            {chip.label}
          </span>
          {/* the fold hides which state this really is, so the card says it */}
          {SUB_STATE[item.col] ? (
            <span className="shrink-0 rounded-[5px] border border-tower-border px-1.5 py-px font-tower-mono text-[8px] uppercase tracking-[0.5px] text-tower-fg-muted">
              {SUB_STATE[item.col]}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── the STATUS story zone: FOCUS / NEXT / RISK band / counts ──────────────────
const STAGE_RANK: Record<string, number> = {
  clearance: 6,
  pilot_look: 5,
  in_review: 4,
  in_flight: 3,
  queued: 2,
  confirmed: 1,
  drafted: 0,
};

// ─── the operator fold (ratified) ────────────────────────────────────────────
// Seven chain states are too many to read, so the board FOLDS to four for the
// operator while the state machine keeps all ten underneath. A folded card
// carries a sub-chip naming its TRUE state, so the fold never hides which prep
// step something is at, nor whose eye it sits under in review — the authority
// difference lives on the chip, not in a column.
const STAGES: { key: string; label: string; states: string[] }[] = [
  {
    key: "prep",
    label: "Backlog",
    states: ["drafted", "confirmed", "queued"],
  },
  { key: "in_flight", label: "Working", states: ["in_flight"] },
  { key: "review", label: "Review", states: ["in_review", "pilot_look"] },
  { key: "clearance", label: "Ready", states: ["clearance"] },
];
const STAGE_OF: Record<string, string> = Object.fromEntries(
  STAGES.flatMap((st) => st.states.map((state) => [state, st.key])),
);
// What a folded card says about itself. Clearance is his alone and never folds,
// so it needs no sub-chip.
const SUB_STATE: Record<string, string> = {
  drafted: "draft",
  confirmed: "confirmed",
  queued: "queued",
  in_review: "lead review",
  pilot_look: "pilot look",
};

/** Compact progress stages for the tasks assigned to one coding agent. */
function TaskStageProgress({ items }: { items: PlacedItem[] }) {
  return (
    <div className="mb-2 flex items-center">
      {STAGES.map((st) => {
        const live = items.some((it) => STAGE_OF[it.col] === st.key);
        return (
          <div
            key={st.key}
            className={
              // No truncate and no tracking: a ratified stage name must read in
              // full at two-up width, so it is sized to fit rather than clipped.
              "min-w-0 flex-1 whitespace-nowrap border-b pb-2 text-center text-xs " +
              (live
                ? "border-tower-fg-dim text-tower-fg-body"
                : "border-tower-border text-tower-fg-faint")
            }
          >
            {st.label}
          </div>
        );
      })}
    </div>
  );
}

/** The real agent thread: streaming, thinking, tools, and a steering composer. */
function AgentThreadSurface({
  threadId,
  projectId,
  providerId,
}: {
  threadId: string;
  projectId: string;
  providerId: string;
}) {
  return (
    <ChatBoundary>
      {/* a definite height, so the chat scrolls its own history and keeps its
          composer in view instead of overflowing the band */}
      <div className="flex h-full min-h-0 flex-col [&>*]:min-h-0 [&>*]:flex-1">
        <EmbeddedThreadChat
          variant="compact"
          surfaceTone="background"
          threadId={threadId}
          surfaceFallbackKey={`tower-lane-${threadId}`}
          projectId={projectId}
          providerId={providerId}
          promptContextEnvironmentId={null}
          resolveMentionLink={() => null}
          composer={{
            draftScope: { kind: "thread", projectId, threadId },
            executionDefaultsThreadId: threadId,
            executionResetKey: threadId,
            permissionPolicy: "snapshot",
            environmentSummary: null,
          }}
        />
      </div>
    </ChatBoundary>
  );
}

/** An agent thread needs backend queries; keep the surface if they fail. */
class ChatBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="grid h-full place-items-center px-3 text-center font-tower-mono text-[9px] italic text-tower-fg-faint">
          This agent&apos;s workspace needs a connected thread.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * An agent workspace card — one per lead, stacked by reporting line.
 *
 * The agent's thread is the primary surface. Current work stays visible above
 * it, while the queue expands only when the operator asks for task detail.
 */
function AgentCard({
  threadId,
  projectId,
  providerId,
  label,
  depth,
  onOpen,
  items,
  escalated,
  hasThread,
}: {
  threadId: string | null;
  projectId: string;
  providerId: string;
  label: string;
  /** How deep this agent sits below the pilot; the card recedes as it grows. */
  depth: number;
  onOpen?: () => void;
  items: PlacedItem[];
  escalated: boolean;
  hasThread: boolean;
}) {
  const workingCount = items.filter((it) => it.col === "in_flight").length;
  const reviewCount = items.filter((it) => HELD_COLS.has(it.col)).length;
  const activeItems = items
    .filter((it) => STAGE_OF[it.col] != null)
    .sort((a, b) => (STAGE_RANK[b.col] ?? -1) - (STAGE_RANK[a.col] ?? -1));
  const terminal = items.filter((it) => it.col === "terminal");

  // FOCUS is the most-advanced active task; NEXT is the next queued task.
  const focus = activeItems[0] ?? null;
  const focusChip = focus ? statusChip(focus) : null;
  const focusAge = focus ? ageSince(focus.attemptAt) : null;
  const next =
    items
      .filter((it) => HOLD_COLS.has(it.col))
      .sort((a, b) => (STAGE_RANK[a.col] ?? 9) - (STAGE_RANK[b.col] ?? 9))[0] ??
    null;

  const silent = items.find(hasLostContact);
  const awaitingApproval = items.filter((it) => it.col === "clearance").length;
  const risk = silent
    ? `${taskNumber(silent.taskId)} is disconnected but remains assigned.`
    : awaitingApproval > 0
      ? `${awaitingApproval} waiting for your approval before this agent can continue.`
      : escalated
        ? "This agent escalated a blocker that needs your input."
        : null;

  const EYE = "text-xs font-medium text-tower-fg-faint";
  // The chrome recedes with depth so the TREE reads as the figure and the
  // cards as its ground: a root card carries the most weight, and each level
  // below it steps down in border strength, title size, and icon size —
  // never color alone, so the gradation still reads in every theme.
  const weight = cardWeightFor(depth);

  const identity = (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-md border bg-tower-input text-tower-fg-muted",
          weight.border,
          weight.iconWrap,
        )}
      >
        <Icon
          name={hasThread ? "Code" : "ListTodo"}
          className={weight.icon}
          aria-hidden
        />
      </span>
      <span className="min-w-0">
        <span className={cn("block truncate text-tower-fg", weight.title)}>
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-tower-fg-faint">
          {hasThread
            ? workingCount > 0
              ? "Coding agent · working"
              : "Coding agent · ready"
            : "Unassigned tasks"}
        </span>
      </span>
    </div>
  );

  return (
    <article
      className={cn(
        "group/agent flex h-[510px] flex-col overflow-hidden rounded-xl border bg-tower-surface transition-colors hover:border-tower-border-strong",
        weight.border,
        weight.shadow,
      )}
    >
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-tower-border px-3.5 py-2.5">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            title={`Open ${label}`}
            className="group/sp min-w-0 rounded-lg text-left outline-none focus-visible:ring-1 focus-visible:ring-tower-fg-dim"
          >
            {identity}
          </button>
        ) : (
          <div className="min-w-0">{identity}</div>
        )}

        <div className="flex shrink-0 items-center gap-1.5 text-xs text-tower-fg-faint">
          <span className="rounded-full bg-tower-panel px-2.5 py-1">
            {workingCount > 0
              ? `${workingCount} working`
              : `${activeItems.length} active`}
          </span>
          {reviewCount > 0 ? (
            <span className="rounded-full bg-tower-panel px-2.5 py-1 text-tower-fg-muted">
              {reviewCount} review
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Keep orientation dense and quiet. This is metadata for the live agent
            thread below, not a second card competing with it. */}
        <section className="shrink-0 border-b border-tower-border bg-tower-inset px-3.5 py-2.5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className={EYE}>Current task</div>
              {focus ? (
                <>
                  <div className="mt-1 truncate text-sm font-medium text-tower-fg">
                    {focus.title}
                  </div>
                  <div className="mt-1 truncate text-xs text-tower-fg-muted">
                    {taskNumber(focus.taskId)}
                    {focusChip ? ` · ${focusChip.label}` : ""}
                    {focusAge ? ` · ${focusAge} ago` : ""}
                  </div>
                </>
              ) : (
                <div className="mt-1 text-sm text-tower-fg-faint">
                  Ready for an assignment.
                </div>
              )}
            </div>
            <div className="min-w-0 max-w-[45%] text-right">
              <div className={EYE}>Up next</div>
              <div className="mt-1 truncate text-sm text-tower-fg-body">
                {next ? next.title : "Nothing queued."}
              </div>
            </div>
          </div>
          {risk ? (
            <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-tower-border bg-tower-surface px-2.5 py-2">
              <Icon
                name="AlertTriangle"
                className="mt-0.5 size-3.5 shrink-0 text-tower-fg-muted"
                aria-hidden
              />
              <div className="min-w-0">
                <span className="text-xs font-medium text-tower-fg-body">
                  Needs attention
                </span>{" "}
                <span className="text-xs leading-relaxed text-tower-fg-muted">
                  {risk}
                </span>
              </div>
            </div>
          ) : null}
        </section>

        <details className="group shrink-0 border-b border-tower-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-xs text-tower-fg-muted transition-colors hover:bg-tower-panel [&::-webkit-details-marker]:hidden">
            <Icon name="ListTodo" className="size-3.5" aria-hidden />
            <span className="font-medium">Task queue</span>
            <span className="text-tower-fg-faint">
              {activeItems.length} active · {terminal.length} completed
            </span>
            <Icon
              name="ChevronDown"
              className="ml-auto size-3.5 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="max-h-56 overflow-y-auto border-t border-tower-border bg-tower-inset p-3.5">
            <TaskStageProgress items={items} />
            {activeItems.length === 0 ? (
              <p className="py-4 text-center text-xs text-tower-fg-faint">
                No active tasks.
              </p>
            ) : (
              STAGES.map((st) => {
                const inStage = activeItems.filter(
                  (it) => STAGE_OF[it.col] === st.key,
                );
                if (inStage.length === 0) return null;
                return (
                  <div key={st.key} className="mb-2 last:mb-0">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-xs font-medium text-tower-fg-muted">
                        {st.label}
                      </span>
                      <span className="h-px flex-1 bg-tower-border" />
                      <span className="text-xs text-tower-fg-faint">
                        {inStage.length}
                      </span>
                    </div>
                    {inStage.map((it) => (
                      <Card key={it.taskId} item={it} />
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </details>

        {/* The lead's thread is the agent card's primary surface. */}
        <section className="flex min-h-0 flex-1 flex-col gap-2 p-3.5">
          <div className="flex shrink-0 items-center justify-between gap-2 px-0.5">
            <span className="text-xs font-medium text-tower-fg-muted">
              Agent thread
            </span>
            {hasThread ? (
              <span className="text-xs text-tower-fg-faint">Live thread</span>
            ) : null}
          </div>
          {hasThread && threadId ? (
            <div
              className="min-h-0 flex-1 overflow-hidden rounded-lg border border-tower-border bg-tower-transcript p-1 [zoom:0.88] [&_[data-follow-up-composer-footer]]:hidden [&_[data-promptbox-action-row]]:hidden [&_*]:[scrollbar-width:none] [&_*::-webkit-scrollbar]:hidden"
              style={
                {
                  "--background": "var(--color-tower-transcript)",
                } as CSSProperties
              }
            >
              <AgentThreadSurface
                threadId={threadId}
                projectId={projectId}
                providerId={providerId}
              />
            </div>
          ) : (
            <div className="grid min-h-36 flex-1 place-items-center rounded-xl border border-dashed border-tower-border px-4 text-center text-xs text-tower-fg-faint">
              No conversation has started yet.
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

function FleetLoadingState() {
  return (
    <div
      className="grid min-h-full grid-cols-1 content-start gap-3.5 px-4 pb-4 @[900px]/board:grid-cols-2"
      aria-label="Preparing crew activity"
      aria-busy="true"
    >
      {[0, 1].map((index) => (
        <div
          key={index}
          className="h-[510px] animate-pulse overflow-hidden rounded-xl border border-tower-border bg-tower-surface"
        >
          <div className="flex h-16 items-center gap-3 border-b border-tower-border px-4">
            <div className="size-9 rounded-md bg-tower-input" />
            <div className="space-y-2">
              <div className="h-3 w-28 rounded-full bg-tower-input" />
              <div className="h-2 w-16 rounded-full bg-tower-panel" />
            </div>
          </div>
          <div className="h-[455px]">
            <div className="h-24 space-y-3 border-b border-tower-border bg-tower-panel px-4 py-3">
              <div className="h-2 w-20 rounded-full bg-tower-input" />
              <div className="h-3 w-44 rounded-full bg-tower-input" />
              <div className="h-2 w-28 rounded-full bg-tower-raised" />
            </div>
            <div className="h-9 border-b border-tower-border px-4 py-3">
              <div className="h-2 w-28 rounded-full bg-tower-panel" />
            </div>
            <div className="h-[323px] p-4">
              <div className="h-full rounded-xl border border-tower-border bg-tower-transcript" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FleetOverviewTab({
  scopeThreadId,
  viewerRole = "commander",
}: {
  scopeThreadId?: string;
  /**
   * Whose board this is. It decides what an EMPTY board means — a commander
   * with no leads and a lead with no sorties are different facts — and nothing
   * about layout: how many cards fit per row is a question for the container,
   * which is why the grid asks the container query and not this.
   */
  viewerRole?: "commander" | "lead" | "sortie";
} = {}) {
  const fleet = useCrewRpc<FleetResult>("crew", "crew_fleet");
  const board = useCrewRpc<BoardResult>("crew", "crew_board");
  const work = useCrewRpc<WorkBoardResult>("crew", "crew_work_board");
  const queue = useCrewRpc<QueueResult>("crew", "crew_queue");
  // The one producer of "waiting on the operator". The board used to derive its
  // own answer from report.escalated, which meant this tab and the sidebar
  // could show different numbers for the same question — and a reader had no
  // way to tell which to believe.
  const attention = useCrewRpc<AttentionResult>("crew", "crew_attention");
  const liveIds = useLiveThreads();
  // A board belongs to the crew whose thread it is opened in. Without this it
  // rendered the rig's WHOLE queue, so a freshly created crew opened showing
  // another crew's work — the first thing the Captain saw in a brand new crew
  // was somebody else's backlog.
  const { threadId: openInThreadId } = useRouteState();
  const crewRootThreadId = scopeThreadId ?? openInThreadId ?? null;
  const [focusedSp, setFocusedSp] = useState<string | null>(null);

  // chat-link nav: bb-tower:sp/<id> focuses; bb-tower:crew returns to the board.
  const towerNav = useAtomValue(towerNavAtom);
  const lastNav = useRef(0);
  if (
    towerNav &&
    towerNav.view === "crew" &&
    towerNav.nonce !== lastNav.current
  ) {
    lastNav.current = towerNav.nonce;
    setFocusedSp(towerNav.spThreadId ?? null);
  }

  // Until the live-thread list has loaded we do not KNOW which crew is retired,
  // and treating "unknown" as "show everything" flashed archived leads onto the
  // board on every load. Unknown means not yet, so the board waits.
  const crewKnown = liveIds !== null;
  const rows = !crewKnown
    ? []
    : (fleet.data?.rows ?? []).filter(
        (r) =>
          r.rank !== "PLT" &&
          liveIds.has(r.threadId) &&
          // a lead's own board carries what it DISPATCHED, never itself:
          // a lead is never the pilot of an item.
          (crewRootThreadId ? r.parentThreadId === crewRootThreadId : true),
      );

  if (focusedSp) {
    const r = (fleet.data?.rows ?? []).find((x) => x.threadId === focusedSp);
    return (
      <SpFocusView
        threadId={focusedSp}
        label={agentLabel(
          r?.handle ?? null,
          liveIds?.get(focusedSp)?.title,
          focusedSp,
        )}
        report={
          board.data?.rows.find((b) => b.threadId === focusedSp)?.report ?? null
        }
        onBack={() => setFocusedSp(null)}
      />
    );
  }

  // owner of each task (the thread a dispatched item runs on) + that attempt's
  // liveness, which is the crew plugin's own verdict — never inferred here.
  const ownerOf = new Map<string, string>();
  const livenessOf = new Map<string, string | null>();
  const sortieOf = new Map<string, string | null>();
  for (const w of work.data?.workItems ?? []) {
    const attempt = w.attempts[0];
    if (attempt?.threadId) {
      ownerOf.set(w.taskId, attempt.threadId);
      livenessOf.set(w.taskId, attempt.liveness ?? null);
      // A sortie with no handle still has a name of its own; only fall back to
      // the id when it has neither, and never print the id in preference.
      sortieOf.set(
        w.taskId,
        attempt.handle ?? liveIds?.get(attempt.threadId)?.title ?? null,
      );
    }
  }
  const place = (state: string): { col: string; termLabel?: string } => {
    if (COL_KEYS.has(state)) return { col: state };
    if (state === "dropped") return { col: "dropped" };
    return { col: "terminal", termLabel: TERMINAL_LABEL[state] ?? state };
  };
  // Work belongs to this crew when a lead of this crew owns it. crew_work_items
  // carries NO crew column (task_id, title, intent, acceptance, brief, state,
  // ord, created_by, created_at, dropped_reason), so a crew is derived from its
  // own leads rather than read from the store — see the finding routed for bb.
  const ownedByCrew = new Set(rows.map((r) => r.threadId));
  const byRow = new Map<string, PlacedItem[]>();
  for (const it of queue.data?.items ?? []) {
    const state = it.displayState ?? it.state;
    const { col, termLabel } = place(state);
    const owner = ownerOf.get(it.taskId) ?? UNASSIGNED;
    // scoped surface: only this agent's own items
    if (crewRootThreadId && !ownedByCrew.has(owner)) continue;
    const list = byRow.get(owner) ?? [];
    list.push({
      taskId: it.taskId,
      title: it.title,
      col,
      termLabel,
      attemptAt: it.lastAttempt?.at ?? null,
      attemptThreadId: it.lastAttempt?.threadId ?? null,
      sortie: sortieOf.get(it.taskId) ?? null,
      liveness: livenessOf.get(it.taskId) ?? null,
      dispatchable: it.dispatchable,
      blockedBecause: it.blockedBecause,
    });
    byRow.set(owner, list);
  }

  const error = fleet.error ?? board.error ?? work.error ?? queue.error;
  const isEscalated = (threadId: string): boolean =>
    board.data?.rows.find((b) => b.threadId === threadId)?.report?.escalated ??
    false;
  // The board is an INSTRUMENT and the fleet has a shape, so it is arranged by
  // rank rather than laid out as equal cards in a grid. A grid says every agent
  // is a peer; the fleet says a sortie answers to a lead. Depth-first from the
  // agents this board owns, each row carrying how deep it sits.
  const childrenOfRow = new Map<string, FleetRow[]>();
  const shownIds = new Set(rows.map((r) => r.threadId));
  for (const r of rows) {
    const parent = r.parentThreadId ?? "";
    if (!shownIds.has(parent)) continue;
    childrenOfRow.set(parent, [...(childrenOfRow.get(parent) ?? []), r]);
  }
  // isLast marks the last child among its own siblings — the drawn rail stops
  // there instead of dangling toward a sibling that doesn't exist.
  const rankedRows: { row: FleetRow; depth: number; isLast: boolean }[] = [];
  const walkRank = (row: FleetRow, depth: number, isLast: boolean): void => {
    rankedRows.push({ row, depth, isLast });
    const children = childrenOfRow.get(row.threadId) ?? [];
    children.forEach((child, index) =>
      walkRank(child, depth + 1, index === children.length - 1),
    );
  };
  // The pilot goes on top, and its crew hangs beneath it. Without it a crew of
  // three leads and no sorties is three cards at the same depth — arranged by
  // rank and looking exactly like the flat grid this replaced, because the rank
  // that makes the others make sense was the one left off the page.
  const pilotRow =
    crewRootThreadId === null
      ? undefined
      : (fleet.data?.rows ?? []).find((r) => r.threadId === crewRootThreadId);
  if (pilotRow !== undefined)
    rankedRows.push({ row: pilotRow, depth: 0, isLast: true });
  const leadDepth = pilotRow === undefined ? 0 : 1;
  const leadRows = rows.filter((r) => !shownIds.has(r.parentThreadId ?? ""));
  leadRows.forEach((r, index) =>
    walkRank(r, leadDepth, index === leadRows.length - 1),
  );

  const unassigned = byRow.get(UNASSIGNED) ?? [];
  const chores = queue.data?.chores ?? null;
  const workingAgentCount = rows.filter((row) =>
    (byRow.get(row.threadId) ?? []).some((item) => item.col === "in_flight"),
  ).length;
  // Agents with something the OPERATOR must clear, read from the same producer
  // the sidebar badges count. Lost contact and clearance items are still shown
  // on the cards themselves — they are operational signals about an agent, not
  // asks addressed to him, and folding them in here is what made this number
  // mean something different from every other place it appears.
  const agentsAwaitingOperator = new Set(
    (attention.data?.open ?? [])
      .filter(
        (item) => item.audience === undefined || item.audience === "operator",
      )
      .map((item) => item.threadId)
      .filter((threadId): threadId is string => typeof threadId === "string"),
  );
  const attentionCount = rows.filter((row) =>
    agentsAwaitingOperator.has(row.threadId),
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-surface">
      {error ? (
        <div className="shrink-0 px-4 pt-3 font-tower-mono text-[9px] text-tower-accent-hover">
          rpc error · {error}
        </div>
      ) : null}

      <div className="@container/board min-h-0 flex-1 overflow-auto">
        {(fleet.loading || !crewKnown) && rows.length === 0 ? (
          <div className="pt-3">
            <FleetLoadingState />
          </div>
        ) : fleet.timedOut && rows.length === 0 ? (
          // Slow and broken need different words. This machine also runs the
          // fleet's CI, so a late answer is a normal condition here rather than
          // evidence of a fault — and a spinner that never stops would say
          // neither.
          <SecondaryPanelEmptyState
            className="min-h-full"
            icon="Clock"
            title="Still checking agent activity"
            description="The coding agents are taking longer than expected to respond."
          />
        ) : rows.length === 0 && unassigned.length === 0 ? (
          <SecondaryPanelEmptyState
            className="min-h-full"
            icon="UserRound"
            title={
              viewerRole === "commander" ? "No leads yet" : "No workers yet"
            }
            description={
              viewerRole === "commander"
                ? "Leads will appear here as this crew takes shape."
                : "This agent has not delegated any tasks yet."
            }
          />
        ) : (
          <>
            <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-4 border-b border-tower-border bg-tower-surface px-4 py-2.5">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-tower-fg">
                  Coding agents
                </h2>
                <p className="mt-0.5 text-xs text-tower-fg-faint">
                  Live threads, current assignments, and review queues
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-xs text-tower-fg-muted">
                <span className="rounded-full bg-tower-panel px-2.5 py-1">
                  {rows.length} {rows.length === 1 ? "agent" : "agents"}
                </span>
                {workingAgentCount > 0 ? (
                  <span className="rounded-full bg-tower-panel px-2.5 py-1">
                    {workingAgentCount} working
                  </span>
                ) : null}
                {attentionCount > 0 ? (
                  <span className="rounded-full border border-tower-border bg-tower-input px-2.5 py-1 text-tower-fg-body">
                    {attentionCount} need input
                  </span>
                ) : null}
              </div>
            </div>
            {/* One column, not a grid. Side-by-side cards buy width and cost
                the only thing this page is for — you cannot see who reports to
                whom in a grid, and that is what was asked for twice.
                role="tree" plus aria-level per row announces the same
                ancestry a sighted operator reads off the rails below. */}
            <div
              role="tree"
              aria-label="Coding agents by reporting line"
              className="flex flex-col content-start items-stretch px-4 py-4"
            >
              {rankedRows.map(({ row: r, depth, isLast }, index) => {
                const spacing = spacingBetween(
                  depth,
                  index === 0 ? null : rankedRows[index - 1].depth,
                );
                const elbow = depth > 0 ? elbowGeometry(depth) : null;
                return (
                  <div
                    key={r.threadId}
                    role="treeitem"
                    aria-level={ariaLevelFor(depth)}
                    className={cn(
                      "relative",
                      index > 0 && FAMILY_SPACING_CLASS[spacing],
                    )}
                    style={{ paddingLeft: `${railIndentPx(depth)}px` }}
                  >
                    {/* One rail per ancestor level, each marking the branch
                        this row hangs off. The row's own level stops at the
                        elbow when it is the last child, so the line ends
                        where the tree does instead of running into open
                        space below the card. */}
                    {Array.from({ length: depth }, (_, level) => (
                      <span
                        key={level}
                        aria-hidden
                        className={cn(
                          "pointer-events-none absolute top-0 w-px bg-tower-border",
                          !(level === depth - 1 && isLast) && "h-full",
                        )}
                        style={{
                          left: `${railLeftPx(level)}px`,
                          height:
                            level === depth - 1 && isLast
                              ? `${ELBOW_TOP_PX}px`
                              : undefined,
                        }}
                      />
                    ))}
                    {elbow ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute h-px bg-tower-border"
                        style={{
                          left: `${elbow.left}px`,
                          width: `${elbow.width}px`,
                          top: `${ELBOW_TOP_PX}px`,
                        }}
                      />
                    ) : null}
                    <AgentCard
                      key={r.threadId}
                      threadId={r.threadId}
                      depth={depth}
                      projectId={liveIds?.get(r.threadId)?.projectId ?? ""}
                      providerId={liveIds?.get(r.threadId)?.providerId ?? ""}
                      label={agentLabel(
                        r.handle,
                        liveIds?.get(r.threadId)?.title,
                        r.threadId,
                      )}
                      onOpen={() => setFocusedSp(r.threadId)}
                      items={byRow.get(r.threadId) ?? []}
                      escalated={isEscalated(r.threadId)}
                      hasThread
                    />
                  </div>
                );
              })}
              {/* the commander's undispatched pipeline (not yet handed to a
                  lead) — a top-level entry of its own, not anyone's child */}
              {!crewRootThreadId && unassigned.length > 0 ? (
                <div
                  role="treeitem"
                  aria-level={1}
                  className={rankedRows.length > 0 ? "mt-6" : undefined}
                >
                  <AgentCard
                    threadId={null}
                    depth={0}
                    projectId=""
                    providerId=""
                    label="Unassigned"
                    items={unassigned}
                    escalated={false}
                    hasThread={false}
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
        {/* De-minimis work, collapsed to one line for the whole board. It sits
            OUTSIDE the crew cards because the count is fleet-wide: putting it
            inside each card would show the same number once per lead. */}
        {chores && chores.count > 0 ? (
          <div className="mx-4 mt-2 mb-3 flex min-w-0 items-baseline gap-2 rounded-[8px] border border-tower-border bg-tower-surface px-3 py-2">
            <span className="shrink-0 font-tower-mono text-[8.5px] uppercase tracking-[0.14em] text-tower-fg-faint">
              chores
            </span>
            <span className="shrink-0 font-tower-mono text-[9px] text-tower-fg-body">
              {chores.count}
            </span>
            {chores.newestTitle ? (
              <span className="min-w-0 flex-1 truncate text-[10px] text-tower-fg-muted">
                newest: {chores.newestTitle}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default FleetOverviewTab;
