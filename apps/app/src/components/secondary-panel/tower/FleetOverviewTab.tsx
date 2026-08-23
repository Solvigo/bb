import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { wsManager } from "@/lib/ws";
import { ageLabel, useCrewRpc } from "./useCrewRpc";
import { SpFocusView } from "./SpFocusView";
import { towerNavAtom } from "./towerNav";

/** Live (non-archived) thread ids — the crew RPC still lists archived threads,
 *  so the board filters against this to drop retired crew. */
function useLiveThreadIds(): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/v1/threads?archived=false");
        const d: unknown = await res.json();
        const list = Array.isArray(d)
          ? d
          : ((d as { threads?: unknown[]; data?: unknown[] }).threads ??
            (d as { data?: unknown[] }).data ??
            []);
        if (!cancelled) {
          setIds(
            new Set(
              (list as { id?: string }[])
                .map((t) => t.id)
                .filter((x): x is string => typeof x === "string"),
            ),
          );
        }
      } catch {
        /* keep the last set; a failed refresh must not blank the board */
      }
    };
    void load();
    const off = wsManager.onPluginSignal((s) => {
      if (s.pluginId === "crew") void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return ids;
}

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
  attempts: { threadId: string }[];
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
  createdAt: string | null;
  lastAttempt: string | null;
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
  at?: string | null; // last activity (or creation) — drives the flight's age
}

const UNASSIGNED = "__unassigned__";

// Chain position → a flight's progress %, so a card reads its distance down the
// runway. Derived from the column, honest (it IS the chain position).
const COL_PROGRESS: Record<string, number> = {
  drafted: 6,
  confirmed: 16,
  queued: 28,
  in_flight: 46,
  in_review: 66,
  pilot_look: 80,
  clearance: 92,
};
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

/** Compact "time since" for a flight's age (v2: "40s", "4m", "2h 20m", "1d 03h"). */
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

// A flight in the air with no fresh transmission has lost contact (v2's SV 118).
const SILENT_AFTER_MS = 2 * 60 * 60 * 1000;

/** The flight's status chip — its condition in airline terms, from chain + age. */
function statusChip(
  col: string,
  ageMs: number | null,
): { label: string; silent: boolean } | null {
  if (col === "in_flight") {
    if (ageMs != null && ageMs > SILENT_AFTER_MS)
      return { label: "lost contact", silent: true };
    return { label: "airborne", silent: false };
  }
  if (col === "queued") return { label: "in the hold", silent: false };
  if (col === "drafted" || col === "confirmed")
    return { label: "planned", silent: false };
  if (col === "in_review" || col === "pilot_look" || col === "clearance")
    return { label: "on final approach", silent: false };
  return null;
}

/** A flight: plane glyph + SV number + age, body, runway progress + %, status chip. */
function Card({ item }: { item: PlacedItem }) {
  const pct = COL_PROGRESS[item.col];
  const age = ageSince(item.at);
  const chip = statusChip(item.col, age?.ms ?? null);
  const silent = chip?.silent ?? false;
  return (
    <div
      className={
        "mb-1.5 rounded-[8px] border px-2 py-1.5 " +
        (silent
          ? "border-tower-border bg-tower-silent"
          : "border-tower-border bg-tower-panel")
      }
      title={item.taskId}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate font-tower-mono text-[10px] text-tower-fg-body">
          <span className="text-tower-flight">✈</span> {svNumber(item.taskId)}
        </span>
        {age ? (
          <span className="shrink-0 font-tower-mono text-[8.5px] text-tower-fg-faint">
            {age.label}
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
      {pct != null ? (
        <div className="mt-1.5">
          <div className="h-[2px] w-full bg-tower-surface">
            <div className="h-[2px] bg-tower-fg-muted" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between gap-1">
            {chip ? (
              <span
                className={
                  "truncate font-tower-mono text-[8px] uppercase tracking-[0.72px] " +
                  (silent ? "text-tower-flight" : "text-tower-fg-faint")
                }
              >
                {chip.label}
              </span>
            ) : (
              <span />
            )}
            <span className="shrink-0 font-tower-mono text-[8.5px] text-tower-fg-muted">
              {pct}%
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── the transcript: the SP's real thread stream, in the DOMAIN rail ───────────
interface TranscriptMsg {
  id: string;
  author: string; // "CONTROLLER" (up) or the lane's own name (down)
  up: boolean; // an inbound instruction from above vs the agent's own voice
  at: number;
  text: string;
}

/** Live thread transcript (conversation rows) for one lane's DOMAIN rail. */
function useThreadTranscript(
  threadId: string,
  laneName: string,
): TranscriptMsg[] {
  const [msgs, setMsgs] = useState<TranscriptMsg[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/threads/${threadId}/timeline`);
        const d = (await res.json()) as {
          rows?: {
            id: string;
            kind: string;
            role: string;
            text?: string | null;
            createdAt: number;
          }[];
        };
        const rows = (d.rows ?? [])
          .filter((r) => r.kind === "conversation" && (r.text ?? "").trim())
          .map((r) => ({
            id: r.id,
            up: r.role === "user",
            author: r.role === "user" ? "CONTROLLER" : laneName.toUpperCase(),
            at: r.createdAt,
            text: (r.text ?? "").trim(),
          }));
        if (!cancelled) setMsgs(rows);
      } catch {
        /* keep last — a failed refresh must not blank the transcript */
      }
    };
    void load();
    const off = wsManager.onPluginSignal((s) => {
      if (s.pluginId === "crew") void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [threadId, laneName]);
  return msgs;
}

function hhmm(at: number): string {
  const d = new Date(at);
  const h = `${d.getHours()}`.padStart(2, "0");
  const m = `${d.getMinutes()}`.padStart(2, "0");
  return `${h}:${m}`;
}

/** The transcript stream — flat author/time/body lines, newest at the bottom. */
function TranscriptStream({ msgs }: { msgs: TranscriptMsg[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);
  if (msgs.length === 0) {
    return (
      <div className="min-h-0 flex-1 px-1 py-2 font-tower-mono text-[9px] italic text-tower-fg-faint">
        No transmissions yet.
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1 py-1.5">
      {msgs.map((m) => (
        <div key={m.id}>
          <div className="mb-0.5 flex items-baseline gap-1.5">
            <span
              className={
                "font-tower-mono text-[8.5px] uppercase tracking-[0.51px] " +
                (m.up ? "text-tower-flight-strong" : "text-tower-fg-muted")
              }
            >
              {m.author}
            </span>
            <span className="font-tower-mono text-[8.5px] text-tower-fg-faint">
              {hhmm(m.at)}
            </span>
          </div>
          <div className="text-[10.5px] leading-snug text-tower-fg-muted">
            {m.text}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

/** The Steer composer — talk to this lane from the board (visual for the shell;
 *  wiring the send is the next pass). */
function SteerComposer({ laneName }: { laneName: string }) {
  return (
    <div className="mt-2 flex shrink-0 items-center gap-1.5 rounded-[8px] border border-tower-input-border bg-tower-input px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate font-tower-sans text-[10.5px] text-tower-fg-dim">
        Steer {laneName}…
      </span>
      <span className="shrink-0 font-tower-mono text-[10px] text-tower-fg-faint">
        ↵
      </span>
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
  const focusChip = focus ? statusChip(focus.col, ageSince(focus.at)?.ms ?? null) : null;

  // NEXT = the next thing to launch (a hold item), lowest-progress first.
  const hold = items
    .filter((it) => HOLD_COLS.has(it.col))
    .sort((a, b) => (STAGE_RANK[a.col] ?? 9) - (STAGE_RANK[b.col] ?? 9));
  const next = hold[0] ?? null;

  // RISK = a real, present danger, in priority order.
  const silent = items.find(
    (it) =>
      it.col === "in_flight" &&
      (ageSince(it.at)?.ms ?? 0) > SILENT_AFTER_MS,
  );
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
              {ageSince(focus.at) ? ` · ${ageSince(focus.at)!.label} ago` : ""}
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
            <div className="mt-0.5 text-[12px] text-tower-fg-body">
              {next.title}
            </div>
            <div className={`mt-0.5 ${META}`}>planned · ready to launch</div>
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
  "grid grid-cols-[minmax(210px,19%)_minmax(300px,44%)_1fr]";

/** One swimlane band — v2's fleet-board shell, one per SP. */
function LaneRow({
  threadId,
  label,
  onOpen,
  items,
  escalated,
  hasThread,
}: {
  threadId: string | null;
  label: string;
  onOpen?: () => void;
  items: PlacedItem[];
  escalated: boolean;
  hasThread: boolean;
}) {
  const transcript = useThreadTranscript(
    hasThread && threadId ? threadId : "",
    label,
  );
  const airborne = items.filter((it) => it.col === "in_flight").length;
  const inHold = items.filter((it) => HOLD_COLS.has(it.col)).length;
  const held = items.filter((it) => HELD_COLS.has(it.col)).length;
  // IN FLIGHT = flights actually in the air or on approach (the mock's right zone).
  const flights = items
    .filter((it) => it.col === "in_flight" || HELD_COLS.has(it.col))
    .sort((a, b) => (STAGE_RANK[b.col] ?? -1) - (STAGE_RANK[a.col] ?? -1));

  return (
    <div className={`${LANE_GRID} min-h-[220px] border-b border-tower-border`}>
      {/* ── DOMAIN rail ── */}
      <div className="flex min-h-0 flex-col border-r border-tower-border px-3 py-3">
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
        <div className="mt-2.5 min-h-0 flex-1">
          {hasThread ? (
            <TranscriptStream msgs={transcript} />
          ) : (
            <div className="px-1 py-2 font-tower-mono text-[9px] italic text-tower-fg-faint">
              Undispatched — no flight deck yet.
            </div>
          )}
        </div>
        {hasThread ? <SteerComposer laneName={label} /> : null}
      </div>

      {/* ── STATUS story ── */}
      <div className="border-r border-tower-border px-3.5 py-3">
        <StatusZone items={items} escalated={escalated} />
      </div>

      {/* ── IN FLIGHT ── */}
      <div className="flex min-h-0 flex-col gap-1.5 px-3 py-3">
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
  const liveIds = useLiveThreadIds();
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

  // owner of each task (the thread a dispatched item runs on), and placement.
  const ownerOf = new Map<string, string>();
  for (const w of work.data?.workItems ?? []) {
    const tid = w.attempts[0]?.threadId;
    if (tid) ownerOf.set(w.taskId, tid);
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
      at: it.lastAttempt ?? it.createdAt,
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
    <div className="flex h-full min-h-0 flex-col bg-tower-render font-tower-sans [zoom:0.9]">
      {/* header band + zone labels */}
      <div className="shrink-0 border-b border-tower-border bg-tower-header">
        <div className="flex items-center justify-between gap-3 px-4 pb-1.5 pt-2.5">
          <span className={COL_LABEL}>Fleet board</span>
          <span className="font-tower-mono text-[10px] text-tower-fg-faint">
            {error ? (
              <span className="text-tower-accent-hover">rpc error</span>
            ) : (
              <>live · as of {ageLabel(age)}</>
            )}
          </span>
        </div>
        <div className={`${LANE_GRID}`}>
          <div className="px-3 pb-1.5">
            <span className={COL_LABEL}>Domain</span>
          </div>
          <div className="px-3.5 pb-1.5">
            <span className={COL_LABEL}>Status</span>
          </div>
          <div className="px-3 pb-1.5">
            <span className={COL_LABEL + " !text-tower-accent-hover"}>
              In flight
            </span>
          </div>
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
