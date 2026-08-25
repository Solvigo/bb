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
import { SpFocusView } from "./SpFocusView";
import { towerNavAtom } from "./towerNav";
import { useRouteState } from "@/hooks/useRouteState";
import { PlatedInsignia, RankInsignia } from "./RankInsignia";
import { stripRankPrefix } from "@/lib/agent-title";

// The 7 chain columns (states); verbs are the transitions between them.
const COLUMNS: { key: string; label: string; accent?: boolean }[] = [
  { key: "drafted", label: "Draft" },
  { key: "confirmed", label: "Confirmed" },
  { key: "queued", label: "Queued" },
  { key: "in_flight", label: "In flight", accent: true },
  { key: "in_review", label: "Review" },
  { key: "pilot_look", label: "Look" },
  { key: "clearance", label: "Clearance", accent: true },
];
const COL_KEYS = new Set(COLUMNS.map((c) => c.key));
const TERMINAL_LABEL: Record<string, string> = {
  accepted: "cleared — awaiting land",
  landed: "landed",
  done: "landed (pre-chain)",
};

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
interface QueueResult {
  ok: boolean;
  items: QueueItem[];
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
function agentLabel(handle: string | null, title: string | undefined, threadId: string): string {
  const raw = handle ?? (title && title.length > 0 ? title : threadId);
  return leadName(raw);
}

function leadName(handle: string): string {
  return stripRankPrefix(handle);
}

/** A task's flight designator — a stable 3-digit SV number from its id. */
function svNumber(taskId: string): string {
  let h = 0;
  for (let i = 0; i < taskId.length; i++)
    h = (Math.imul(h, 31) + taskId.charCodeAt(i)) >>> 0;
  return `SV ${100 + (h % 900)}`;
}

/** Compact "time since" (v2: "40s", "4m", "2h 20m", "1d 03h"). */
function ageSince(at?: string | null): { label: string; ms: number } | null {
  if (!at) return null;
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return { label: `${s}s`, ms };
  const m = Math.floor(s / 60);
  if (m < 60) return { label: `${m}m`, ms };
  const h = Math.floor(m / 60);
  if (h < 24) return { label: `${h}h ${m % 60}m`, ms };
  return { label: `${Math.floor(h / 24)}d ${h % 24}h`, ms };
}

/** A flight has lost contact when the crew plugin says its attempt is gone —
 *  its own verdict, never a guess from how long the card has been sitting. */
function hasLostContact(item: PlacedItem): boolean {
  return (
    item.col === "in_flight" &&
    (item.liveness === "dead-or-gone" || item.liveness === "dead")
  );
}

/** The flight's status chip — its condition in airline terms, from real state. */
function statusChip(item: PlacedItem): { label: string; silent: boolean } | null {
  if (item.col === "in_flight") {
    if (hasLostContact(item)) return { label: "lost contact", silent: true };
    return { label: "airborne", silent: false };
  }
  if (item.col === "queued") return { label: "in the hold", silent: false };
  if (item.col === "drafted" || item.col === "confirmed")
    return { label: "planned", silent: false };
  if (HELD_COLS.has(item.col))
    return { label: "on final approach", silent: false };
  return null;
}

/** A flight: plane glyph + SV number + time aloft, body, status chip.
 *  Time aloft shows only for a dispatched flight — an undispatched item has
 *  never left the ground, so there is nothing to count. */
function Card({ item }: { item: PlacedItem }) {
  const aloft = ageSince(item.attemptAt);
  const chip = statusChip(item);
  const silent = chip?.silent ?? false;
  const stageIndex = STAGES.findIndex((st) => st.key === STAGE_OF[item.col]);
  // What this sortie is actually doing, straight from its own transcript.
  const activity = useSortieActivity(item.attemptThreadId);
  return (
    <div
      className={
        "mb-1.5 rounded-[8px] border px-2 py-1.5 " +
        (silent
          ? "border-tower-border bg-tower-silent"
          : "border-tower-border bg-tower-raised")
      }
      title={item.taskId}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate font-tower-mono text-[10px] text-tower-fg-body">
          {svNumber(item.taskId)}
          {/* the SORTIE flying this item — a lead never flies one itself */}
          {item.sortie ? (
            <span className="text-tower-fg-muted"> · {leadName(item.sortie)}</span>
          ) : null}
        </span>
        {aloft ? (
          <span className="shrink-0 font-tower-mono text-[8.5px] text-tower-fg-faint">
            {aloft.label}
          </span>
        ) : null}
      </div>
      <div
        className={
          "mt-1 line-clamp-2 text-[11px] leading-snug " +
          (silent ? "text-tower-flight" : "text-tower-fg-body")
        }
      >
        {item.title}
      </div>
      {/* The card's own runway: four stage positions, and the aircraft sits at
          the one it has reached — so how far it has flown is legible before any
          label is read. */}
      {stageIndex >= 0 ? (
        // The aircraft flies ABOVE its runway, not on it: the glyph is 16px tall
        // from the top, so the line sits at 22px to leave real air beneath it.
        <div className="relative mt-2 mb-1 h-[24px]">
          <div className="absolute inset-x-0 top-[22px] h-px bg-tower-bright" />
          <div
            className="absolute inset-x-0 top-[22px] h-px bg-tower-flight/50"
            style={{ width: `${((stageIndex + 0.5) / STAGES.length) * 100}%` }}
          />
          <span
            className="absolute top-0 -translate-x-1/2"
            style={{ left: `${((stageIndex + 0.5) / STAGES.length) * 100}%` }}
          >
            <RankInsignia
              rank="sortie"
              state={item.col === "in_flight" && !silent ? "working" : "waiting"}
              size={16}
              title={`${svNumber(item.taskId)} — ${chip?.label ?? "planned"}`}
            />
          </span>
        </div>
      ) : null}
      {/* the sortie's last line of activity — its own transcript, live */}
      {activity ? (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-[8px] bg-tower-surface px-2 py-1.5">
          <span
            className={
              "mt-px shrink-0 font-tower-mono text-[8px] uppercase tracking-[0.6px] " +
              (activity.working
                ? "text-tower-flight-strong"
                : "text-tower-fg-faint")
            }
          >
            {activity.working ? "live" : "last"}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 font-tower-mono text-[9.5px] leading-snug text-tower-fg-body">
            {activity.line}
          </span>
        </div>
      ) : null}
      {!item.sortie && STAGE_OF[item.col] === "in_flight" ? (
        <div className="mt-1.5 font-tower-mono text-[8.5px] italic text-tower-fg-faint">
          no sortie dispatched
        </div>
      ) : null}
      {chip ? (
        <div className="mt-1.5 flex items-center justify-between gap-1.5">
          <span
            className={
              "truncate font-tower-mono text-[8px] uppercase tracking-[0.72px] " +
              (silent ? "text-tower-flight" : "text-tower-fg-faint")
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
  { key: "prep", label: "Prep", states: ["drafted", "confirmed", "queued"] },
  { key: "in_flight", label: "In flight", states: ["in_flight"] },
  { key: "review", label: "Review", states: ["in_review", "pilot_look"] },
  { key: "clearance", label: "Clearance", states: ["clearance"] },
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

/** The runway: four ticks, lit where this lane actually has flights. */
function StageRunway({ items }: { items: PlacedItem[] }) {
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
              "min-w-0 flex-1 whitespace-nowrap border-b pb-1.5 text-center font-tower-mono text-[8.5px] uppercase " +
              (live
                ? "border-tower-flight text-tower-flight"
                : "border-tower-bright text-tower-fg-faint")
            }
          >
            {st.label}
          </div>
        );
      })}
    </div>
  );
}

// ─── the lane row: DOMAIN rail | STATUS story | IN FLIGHT cards ────────────────
/** The lane's live flight deck — bb's own chat on the agent's thread, so the
 *  rail gets the real thing (streaming, thinking, tool calls) and a composer
 *  that steers, instead of a hand-rolled retelling of it. */
function LaneFlightDeck({
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

/** A lane's chat needs backend queries; keep the band if they fail. */
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
          This lane&apos;s flight deck needs a connected thread.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * A LEAD CARD — one per agent, two per row.
 *
 * Lifted from the Lead Cards sheet: a contained card split into the lead's own
 * side (identity, its focus and what is next, its live conversation) and its
 * IN FLIGHT side. Values are the sheet's own — card #1F1E1D on a 1px #302F2C
 * edge at radius 16, focus block inset at #232322 radius 12, flight cards
 * #262624 radius 11, and the tool line recessed to #1F1E1D radius 8.
 */
function LeadCard({
  threadId,
  projectId,
  providerId,
  label,
  onOpen,
  items,
  escalated,
  hasThread,
}: {
  threadId: string | null;
  projectId: string;
  providerId: string;
  label: string;
  onOpen?: () => void;
  items: PlacedItem[];
  escalated: boolean;
  hasThread: boolean;
}) {
  const airborne = items.filter((it) => it.col === "in_flight").length;
  const held = items.filter((it) => HELD_COLS.has(it.col)).length;
  const onBoard = items
    .filter((it) => STAGE_OF[it.col] != null)
    .sort((a, b) => (STAGE_RANK[b.col] ?? -1) - (STAGE_RANK[a.col] ?? -1));
  const terminal = items.filter((it) => it.col === "terminal");

  // FOCUS is the most-advanced live flight; NEXT is the next thing to launch.
  const focus = onBoard[0] ?? null;
  const focusChip = focus ? statusChip(focus) : null;
  const focusAloft = focus ? ageSince(focus.attemptAt) : null;
  const next =
    items
      .filter((it) => HOLD_COLS.has(it.col))
      .sort((a, b) => (STAGE_RANK[a.col] ?? 9) - (STAGE_RANK[b.col] ?? 9))[0] ??
    null;

  const silent = items.find(hasLostContact);
  const awaitingClearance = items.filter((it) => it.col === "clearance").length;
  const risk = silent
    ? `${svNumber(silent.taskId)} has lost contact — still assigned, still burning.`
    : awaitingClearance > 0
      ? `${awaitingClearance} waiting on your clearance before this lead can move on.`
      : escalated
        ? "A mayday is standing on this lead."
        : null;

  const EYE =
    "font-tower-mono text-[8.5px] uppercase tracking-[0.85px] text-tower-fg-dim";

  const identity = (
    <div className="flex items-center gap-2.5">
      <PlatedInsignia
        rank={hasThread ? "lead" : "sortie"}
        state={airborne > 0 ? "working" : "waiting"}
        plate={38}
      />
      <span
        className={
          "min-w-0 flex-1 truncate text-[18px] font-semibold text-tower-fg" +
          (onOpen ? " group-hover/sp:text-tower-accent-hover" : "")
        }
      >
        {label}
      </span>
      {held > 0 ? (
        <span className="shrink-0 rounded-[6px] bg-tower-accent-tint px-1.5 py-0.5 font-tower-mono text-[8.5px] font-semibold uppercase tracking-[0.68px] text-tower-flight-strong">
          {held} held
        </span>
      ) : null}
    </div>
  );

  return (
    <article className="grid min-h-[560px] grid-cols-[minmax(0,55%)_minmax(0,45%)] overflow-hidden rounded-[16px] border border-tower-bright bg-tower-surface">
      {/* ── the lead ── */}
      <div className="flex min-h-0 flex-col gap-3 border-r border-tower-bright p-4">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            title={`Open ${label}`}
            className="group/sp shrink-0 text-left"
          >
            {identity}
          </button>
        ) : (
          <div className="shrink-0">{identity}</div>
        )}

        {/* what it is on, and what it takes next */}
        <div className="shrink-0 rounded-[12px] bg-tower-inset px-3.5 py-3">
          <div className={EYE}>Focus</div>
          {focus ? (
            <>
              <div className="mt-0.5 truncate text-[13px] font-[650] text-tower-fg">
                {focus.title}
              </div>
              <div className="mt-0.5 truncate font-tower-mono text-[9px] text-tower-fg-muted">
                {svNumber(focus.taskId)}
                {focusChip ? ` · ${focusChip.label}` : ""}
                {focusAloft ? ` · ${focusAloft.label} ago` : ""}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-[12px] italic text-tower-fg-faint">
              Nothing in the air.
            </div>
          )}
          <div className="my-2.5 h-px bg-tower-border" />
          <div className="flex items-baseline gap-2">
            <span className={`${EYE} shrink-0`}>Next</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-tower-fg-body">
              {next ? next.title : "Nothing queued."}
            </span>
          </div>
        </div>

        {risk ? (
          <div className="shrink-0 rounded-[10px] bg-tower-silent px-3 py-2">
            <span className="font-tower-mono text-[8.5px] font-bold uppercase tracking-[0.85px] text-tower-flight">
              Risk
            </span>{" "}
            <span className="text-[10.5px] text-tower-fg-body">{risk}</span>
          </div>
        ) : null}

        {/* the lead's live conversation, with its own composer */}
        {hasThread && threadId ? (
          <div
            className="min-h-0 flex-1 overflow-hidden rounded-[10px] border border-tower-border bg-tower-transcript p-1 [zoom:0.85] [&_[data-follow-up-composer-footer]]:hidden [&_[data-promptbox-action-row]]:hidden [&_*]:[scrollbar-width:none] [&_*::-webkit-scrollbar]:hidden"
            style={
              { "--background": "var(--color-tower-transcript)" } as CSSProperties
            }
          >
            <LaneFlightDeck
              threadId={threadId}
              projectId={projectId}
              providerId={providerId}
            />
          </div>
        ) : (
          <div className="font-tower-mono text-[9px] italic text-tower-fg-faint">
            Undispatched — no flight deck yet.
          </div>
        )}
      </div>

      {/* ── in flight ── */}
      <div className="flex min-h-0 flex-col overflow-y-auto p-4">
        <div className="mb-2 shrink-0 font-tower-mono text-[9px] uppercase tracking-[0.14em] text-tower-accent">
          In flight
        </div>
        <StageRunway items={items} />
        {onBoard.length === 0 ? (
          <div className="font-tower-mono text-[9px] italic text-tower-fg-faint">
            No flights in the air.
          </div>
        ) : (
          STAGES.map((st) => {
            const inStage = onBoard.filter((it) => STAGE_OF[it.col] === st.key);
            if (inStage.length === 0) return null;
            return (
              <div key={st.key} className="mb-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-tower-mono text-[8.5px] uppercase tracking-[0.14em] text-tower-fg-muted">
                    {st.label}
                  </span>
                  <span className="h-px flex-1 bg-tower-border" />
                  <span className="font-tower-mono text-[8px] text-tower-fg-faint">
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
        {terminal.length > 0 ? (
          <div className="mt-auto pt-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-tower-mono text-[8.5px] uppercase tracking-[0.14em] text-tower-fg-faint">
                Terminal
              </span>
              <span className="h-px flex-1 bg-tower-border" />
            </div>
            {terminal.map((it) => (
              <div
                key={it.taskId}
                title={it.taskId}
                className="mb-1 inline-flex rounded-full border border-tower-border px-2 py-0.5 font-tower-mono text-[8px] uppercase tracking-[0.6px] text-tower-fg-dim"
              >
                {it.termLabel}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </article>
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
  if (towerNav && towerNav.view === "crew" && towerNav.nonce !== lastNav.current) {
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
        label={agentLabel(r?.handle ?? null, liveIds?.get(focusedSp)?.title, focusedSp)}
        domain={r?.parentThreadId ? "lead" : "commander"}
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
  const unassigned = byRow.get(UNASSIGNED) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-render font-tower-sans">
      {error ? (
        <div className="shrink-0 px-4 pt-3 font-tower-mono text-[9px] text-tower-accent-hover">
          rpc error · {error}
        </div>
      ) : null}

      <div className="@container/board min-h-0 flex-1 overflow-auto pt-3">
        {(fleet.loading || !crewKnown) && rows.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">loading leads…</div>
        ) : rows.length === 0 && unassigned.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">
            {viewerRole === "commander"
              ? "No leads yet."
              : "No sorties dispatched by this lead yet — its work items exist on the fleet board but no sortie has been spawned to fly them."}
          </div>
        ) : (
          // Two lead cards per row, as the sheet lays them out. A nested
          // surface has half the width, so it stacks instead.
          // Two lead cards per row (the Captain's preference and the sheet's own
          // annotation), with the height the pair costs in width given back
          // vertically. The stage ticks are sized to stay readable at this
          // narrower zone — the earlier two-up truncated them, which is what
          // made it look wrong, not the pairing itself. A nested surface has
          // half the width again, so it stacks.
          <div
            className={
              "grid gap-4 px-4 pb-4 " +
              // Two per row is the Captain's preference, but only where two
              // READABLE cards fit. The sheet's card is 691px; at the 720px
              // breakpoint each got 402px and the stage ticks collapsed to
              // 6.5px and collided. So the pair is asked for at a width that
              // can actually hold it, and below that one full-width card wins
              // over two illegible ones.
              "grid-cols-1 @[1240px]/board:grid-cols-2"
            }
          >
            {rows.map((r) => (
              <LeadCard
                key={r.threadId}
                threadId={r.threadId}
                projectId={liveIds?.get(r.threadId)?.projectId ?? ""}
                providerId={liveIds?.get(r.threadId)?.providerId ?? ""}
                label={agentLabel(r.handle, liveIds?.get(r.threadId)?.title, r.threadId)}
                onOpen={() => setFocusedSp(r.threadId)}
                items={byRow.get(r.threadId) ?? []}
                escalated={isEscalated(r.threadId)}
                hasThread
              />
            ))}
            {/* the commander's undispatched pipeline (not yet handed to a lead) */}
            {!crewRootThreadId && unassigned.length > 0 ? (
              <LeadCard
                threadId={null}
                projectId=""
                providerId=""
                label="Unassigned"
                items={unassigned}
                escalated={false}
                hasThread={false}
              />
            ) : null}
          </div>
        )}
      </div>

    </div>
  );
}

export default FleetOverviewTab;
