import { Component, useRef, useState, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import { ageLabel, useCrewRpc } from "./useCrewRpc";
import { useLiveThreads } from "./useLiveThreads";
import { SpFocusView } from "./SpFocusView";
import { towerNavAtom } from "./towerNav";

const COL_LABEL =
  "font-tower-mono text-[9px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim";

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
  dispatchable: boolean;
  blockedBecause: string | null;
}

const UNASSIGNED = "__unassigned__";

// Honest buckets from chain state (v2 airline vocabulary):
const HOLD_COLS = new Set(["drafted", "confirmed", "queued"]); // waiting to launch
const HELD_COLS = new Set(["in_review", "pilot_look", "clearance"]); // held at a gate

/** A task's flight designator — a stable 3-digit SV number from its id. */
function svNumber(taskId: string): string {
  let h = 0;
  for (let i = 0; i < taskId.length; i++)
    h = (Math.imul(h, 31) + taskId.charCodeAt(i)) >>> 0;
  return `SV ${100 + (h % 900)}`;
}

/** Two-letter flight code from a lane's handle ("surface dispatch" → "SU"). */
function laneCode(label: string): string {
  const word = label.replace(/^thr_/, "").replace(/[^a-zA-Z]+/, " ").trim();
  return (word.slice(0, 2) || label.slice(0, 2)).toUpperCase();
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
          <span className="text-tower-flight">✈</span> {svNumber(item.taskId)}
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
      {chip ? (
        <div
          className={
            "mt-1.5 truncate font-tower-mono text-[8px] uppercase tracking-[0.72px] " +
            (silent ? "text-tower-flight" : "text-tower-fg-faint")
          }
        >
          {chip.label}
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

function StatusZone({
  items,
  escalated,
}: {
  items: PlacedItem[];
  escalated: boolean;
}) {
  const up = items.filter((it) => it.col === "in_flight").length;
  const approach = items.filter((it) => HELD_COLS.has(it.col)).length;
  const planned = items.filter(
    (it) => it.col === "queued" || it.col === "confirmed",
  ).length;
  const ideas = items.filter((it) => it.col === "drafted").length;

  // FOCUS = the most-advanced active flight (nearest landing).
  const active = items
    .filter((it) => STAGE_RANK[it.col] != null && it.col !== "drafted")
    .sort((a, b) => (STAGE_RANK[b.col] ?? -1) - (STAGE_RANK[a.col] ?? -1));
  const focus = active[0] ?? null;
  const focusChip = focus ? statusChip(focus) : null;
  const focusAloft = focus ? ageSince(focus.attemptAt) : null;

  // NEXT = the next thing to launch (a hold item), earliest stage first.
  const hold = items
    .filter((it) => HOLD_COLS.has(it.col))
    .sort((a, b) => (STAGE_RANK[a.col] ?? 9) - (STAGE_RANK[b.col] ?? 9));
  const next = hold[0] ?? null;

  // RISK = a real, present danger, in priority order.
  const silent = items.find(hasLostContact);
  const awaitingClearance = items.filter((it) => it.col === "clearance").length;
  let risk: string | null = null;
  if (silent)
    risk = `${svNumber(silent.taskId)} has lost contact — still assigned, still burning.`;
  else if (awaitingClearance > 0)
    risk = `${awaitingClearance} waiting on your clearance before this domain can move on.`;
  else if (escalated) risk = "A mayday is standing on this lane.";

  const COUNT: [string, number][] = [
    ["up", up],
    ["approach", approach],
    ["planned", planned],
    ["ideas", ideas],
  ];
  const META = "font-tower-mono text-[9px] text-tower-fg-dim";
  const EYE =
    "font-tower-mono text-[8.5px] uppercase tracking-[0.85px] text-tower-fg-dim";

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      <div>
        <div className={EYE}>Focus</div>
        {focus ? (
          <>
            <div className="mt-0.5 text-[12px] font-semibold text-tower-fg">
              {focus.title}
            </div>
            <div className="mt-0.5 font-tower-mono text-[9px] text-tower-fg-muted">
              {svNumber(focus.taskId)}
              {focusChip ? ` · ${focusChip.label}` : ""}
              {focusAloft ? ` · ${focusAloft.label} ago` : ""}
            </div>
          </>
        ) : (
          <div className="mt-0.5 text-[11px] italic text-tower-fg-faint">
            Nothing in the air.
          </div>
        )}
      </div>

      <div>
        <div className={EYE}>Next</div>
        {next ? (
          <>
            <div className="mt-0.5 text-[11.5px] text-tower-fg-body">
              {next.title}
            </div>
            <div className={`mt-0.5 ${META}`}>
              {next.dispatchable
                ? "ready to launch"
                : (next.blockedBecause ?? "not ready to launch")}
            </div>
          </>
        ) : (
          <div className="mt-0.5 text-[11px] italic text-tower-fg-faint">
            Nothing queued.
          </div>
        )}
      </div>

      {risk ? (
        <div className="rounded-[9px] bg-tower-silent px-[9px] py-2">
          <span className="font-tower-mono text-[8.5px] font-bold uppercase tracking-[0.85px] text-tower-flight">
            Risk
          </span>{" "}
          <span className="text-[10.5px] text-tower-fg-body">{risk}</span>
        </div>
      ) : null}

      <div className="mt-auto flex items-baseline gap-3 pt-1">
        {COUNT.map(([label, n]) => (
          <span key={label} className="flex items-baseline gap-1">
            <span className="font-tower-mono text-[10px] font-bold text-tower-fg-body">
              {n}
            </span>
            <span className="font-tower-mono text-[8.5px] uppercase tracking-[0.51px] text-tower-fg-muted">
              {label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── the lane row: DOMAIN rail | STATUS story | IN FLIGHT cards ────────────────
const LANE_GRID =
  "grid grid-cols-[minmax(260px,27%)_minmax(240px,33%)_1fr]";
// A lane is a fixed band, never as tall as its transcript: each zone scrolls
// inside it, so one talkative agent cannot push the rest of the fleet offscreen.
const LANE_HEIGHT = "h-[440px]";

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

/** One swimlane band — v2's fleet-board shell, one per SP. */
function LaneRow({
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
  const inHold = items.filter((it) => HOLD_COLS.has(it.col)).length;
  const held = items.filter((it) => HELD_COLS.has(it.col)).length;
  // IN FLIGHT = flights actually in the air or on approach (the mock's right zone).
  const flights = items
    .filter((it) => it.col === "in_flight" || HELD_COLS.has(it.col))
    .sort((a, b) => (STAGE_RANK[b.col] ?? -1) - (STAGE_RANK[a.col] ?? -1));

  return (
    <div
      className={`${LANE_GRID} ${LANE_HEIGHT} mx-4 mb-4 overflow-hidden rounded-[14px] border border-tower-border-strong bg-tower-panel`}
    >
      {/* ── DOMAIN rail ── */}
      <div className="flex min-h-0 flex-col border-r border-tower-border px-3.5 py-3.5">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            title={`Open ${label}`}
            className="group/sp shrink-0 text-left"
          >
            <LaneIdentity
              label={label}
              held={held}
              airborne={airborne}
              inHold={inHold}
              linked
            />
          </button>
        ) : (
          <div className="shrink-0">
            <LaneIdentity
              label={label}
              held={held}
              airborne={airborne}
              inHold={inHold}
            />
          </div>
        )}
        {/* the flight deck sits INSET — a recessed panel, as in v2 — and
            scrolls inside the band rather than growing it */}
        {hasThread && threadId ? (
          <div className="mt-2.5 min-h-0 flex-1 overflow-hidden rounded-[10px] border border-tower-border bg-tower-transcript p-1 [zoom:0.85] [&_[data-follow-up-composer-footer]]:hidden [&_[data-promptbox-action-row]]:hidden">
            <LaneFlightDeck
              threadId={threadId}
              projectId={projectId}
              providerId={providerId}
            />
          </div>
        ) : (
          <div className="mt-2.5 font-tower-mono text-[9px] italic text-tower-fg-faint">
            Undispatched — no flight deck yet.
          </div>
        )}
      </div>

      {/* ── STATUS story ── */}
      <div className="border-r border-tower-border px-4 py-3.5">
        <StatusZone items={items} escalated={escalated} />
      </div>

      {/* ── IN FLIGHT ── */}
      <div className="flex min-h-0 flex-col gap-1.5 px-3.5 py-3.5">
        {flights.length > 0 ? (
          flights.map((it) => <Card key={it.taskId} item={it} />)
        ) : (
          <div className="px-1 py-2 font-tower-mono text-[9px] italic text-tower-fg-faint">
            No flights in the air.
          </div>
        )}
      </div>
    </div>
  );
}

/** The lane's identity block — avatar, name, HELD pill, airborne line. */
function LaneIdentity({
  label,
  held,
  airborne,
  inHold,
  linked,
}: {
  label: string;
  held: number;
  airborne: number;
  inHold: number;
  linked?: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-tower-bright font-tower-mono text-[9.5px] font-bold text-tower-fg-muted">
          {laneCode(label)}
        </span>
        <span
          className={
            "min-w-0 flex-1 truncate text-[12.5px] font-[650] text-tower-fg-body" +
            (linked ? " group-hover/sp:text-tower-accent-hover" : "")
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
      <div className="mt-1.5 truncate font-tower-mono text-[9px] text-tower-flight">
        {airborne || inHold ? (
          <>
            {airborne} airborne
            {inHold > 0 ? ` · ${inHold} in the hold` : ""}
          </>
        ) : (
          <span className="text-tower-fg-faint">on the ground</span>
        )}
      </div>
    </>
  );
}

export function FleetOverviewTab({
  scopeThreadId,
}: {
  scopeThreadId?: string;
} = {}) {
  const fleet = useCrewRpc<FleetResult>("crew", "crew_fleet");
  const board = useCrewRpc<BoardResult>("crew", "crew_board");
  const work = useCrewRpc<WorkBoardResult>("crew", "crew_work_board");
  const queue = useCrewRpc<QueueResult>("crew", "crew_queue");
  const liveIds = useLiveThreads();
  const [focusedSp, setFocusedSp] = useState<string | null>(null);

  // chat-link nav: bb-tower:sp/<id> focuses; bb-tower:crew returns to the board.
  const towerNav = useAtomValue(towerNavAtom);
  const lastNav = useRef(0);
  if (towerNav && towerNav.view === "crew" && towerNav.nonce !== lastNav.current) {
    lastNav.current = towerNav.nonce;
    setFocusedSp(towerNav.spThreadId ?? null);
  }

  const rows = (fleet.data?.rows ?? []).filter(
    (r) =>
      r.rank !== "PLT" &&
      (liveIds === null || liveIds.has(r.threadId)) &&
      (scopeThreadId ? r.parentThreadId === scopeThreadId : true),
  );

  if (focusedSp) {
    const r = (fleet.data?.rows ?? []).find((x) => x.threadId === focusedSp);
    return (
      <SpFocusView
        threadId={focusedSp}
        label={r?.handle ?? focusedSp}
        domain={r?.parentThreadId ? "domain lead" : "root pilot"}
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
  for (const w of work.data?.workItems ?? []) {
    const attempt = w.attempts[0];
    if (attempt?.threadId) {
      ownerOf.set(w.taskId, attempt.threadId);
      livenessOf.set(w.taskId, attempt.liveness ?? null);
    }
  }
  const place = (state: string): { col: string; termLabel?: string } => {
    if (COL_KEYS.has(state)) return { col: state };
    if (state === "dropped") return { col: "dropped" };
    return { col: "terminal", termLabel: TERMINAL_LABEL[state] ?? state };
  };
  const byRow = new Map<string, PlacedItem[]>();
  for (const it of queue.data?.items ?? []) {
    const state = it.displayState ?? it.state;
    const { col, termLabel } = place(state);
    const owner = ownerOf.get(it.taskId) ?? UNASSIGNED;
    // scoped surface: only this agent's own items
    if (scopeThreadId && owner !== scopeThreadId) continue;
    const list = byRow.get(owner) ?? [];
    list.push({
      taskId: it.taskId,
      title: it.title,
      col,
      termLabel,
      attemptAt: it.lastAttempt?.at ?? null,
      liveness: livenessOf.get(it.taskId) ?? null,
      dispatchable: it.dispatchable,
      blockedBecause: it.blockedBecause,
    });
    byRow.set(owner, list);
  }

  const age = Math.max(
    fleet.ageSeconds,
    board.ageSeconds,
    work.ageSeconds,
    queue.ageSeconds,
  );
  const error = fleet.error ?? board.error ?? work.error ?? queue.error;
  const isEscalated = (threadId: string): boolean =>
    board.data?.rows.find((b) => b.threadId === threadId)?.report?.escalated ??
    false;
  const unassigned = byRow.get(UNASSIGNED) ?? [];

  // footer provenance (v2: "hangar N · logbook N · read HH:MM — N sources").
  const hangar = rows.length; // lanes on the board
  const logbook = (queue.data?.items ?? []).filter(
    (it) => (it.displayState ?? it.state) !== "dropped",
  ).length; // flights on record (dropped excluded)
  const sources = [fleet, board, work, queue];
  const responded = sources.filter((s) => !s.error).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-render font-tower-sans">
      {/* zone labels only — no band of its own: the panel chrome above is the
          one grey header on this surface. */}
      <div className={`${LANE_GRID} shrink-0 px-3 pb-1.5 pt-2.5`}>
        <div className="px-1">
          <span className={COL_LABEL}>Domain</span>
        </div>
        <div className="px-1">
          <span className={COL_LABEL}>Status</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 px-1">
          <span className={COL_LABEL + " !text-tower-accent-hover"}>
            In flight
          </span>
          {error ? (
            <span className="font-tower-mono text-[9px] text-tower-accent-hover">
              rpc error
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {fleet.loading && rows.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">loading crew…</div>
        ) : rows.length === 0 && unassigned.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">
            {scopeThreadId ? "No crew or work under this agent yet." : "No crew yet."}
          </div>
        ) : (
          <>
            {rows.map((r) => (
              <LaneRow
                key={r.threadId}
                threadId={r.threadId}
                projectId={liveIds?.get(r.threadId)?.projectId ?? ""}
                providerId={liveIds?.get(r.threadId)?.providerId ?? ""}
                label={r.handle ?? r.threadId}
                onOpen={() => setFocusedSp(r.threadId)}
                items={byRow.get(r.threadId) ?? []}
                escalated={isEscalated(r.threadId)}
                hasThread
              />
            ))}
            {/* the pilot's undispatched pipeline (not yet handed to an SP) */}
            {!scopeThreadId && unassigned.length > 0 ? (
              <LaneRow
                threadId={null}
                projectId=""
                providerId=""
                label="Unassigned"
                items={unassigned}
                escalated={false}
                hasThread={false}
              />
            ) : null}
          </>
        )}
      </div>

      {/* footer provenance strip — the airline logbook line */}
      <div className="flex shrink-0 items-center gap-2.5 border-t border-tower-border bg-tower-surface px-4 py-1.5 font-tower-mono text-[9px] text-tower-fg-faint">
        <span>hangar {hangar}</span>
        <span>·</span>
        <span>logbook {logbook}</span>
        <span>·</span>
        <span>
          read {ageLabel(age)} — {responded}/{sources.length} sources
          {responded < sources.length ? (
            <span className="text-tower-accent-hover"> · degraded</span>
          ) : (
            " responded"
          )}
        </span>
      </div>
    </div>
  );
}

export default FleetOverviewTab;
