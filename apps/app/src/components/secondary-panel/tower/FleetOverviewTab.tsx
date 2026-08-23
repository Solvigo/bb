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
const GRID =
  "grid grid-cols-[minmax(180px,15%)_repeat(7,minmax(112px,1fr))_minmax(150px,14%)]";

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
// Three honest buckets from chain state (v2 airline vocabulary):
const AIRBORNE_COLS = new Set(["in_flight"]); // executing
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

/** One swimlane: a DOMAIN identity cell + the 7 state columns + the terminal rail. */
function Swimlane({
  label,
  sub,
  onOpen,
  items,
  showDropped,
}: {
  label: string;
  sub: string;
  onOpen?: () => void;
  items: PlacedItem[];
  showDropped: boolean;
}) {
  const inCol = (key: string) => items.filter((it) => it.col === key);
  const terminal = items.filter((it) => it.col === "terminal");
  const dropped = items.filter((it) => it.col === "dropped");
  const airborne = items.filter((it) => AIRBORNE_COLS.has(it.col)).length;
  const inHold = items.filter((it) => HOLD_COLS.has(it.col)).length;
  const held = items.filter((it) => HELD_COLS.has(it.col)).length;
  const identity = (
    <>
      <div className="flex items-center gap-2">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-tower-bright font-tower-mono text-[9.5px] font-bold text-tower-fg-muted">
          {laneCode(label)}
        </span>
        <span
          className={
            "min-w-0 flex-1 truncate text-[12.5px] font-[650] text-tower-fg-body" +
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
      <div className="mt-1.5 truncate font-tower-mono text-[9px] text-tower-flight">
        {airborne || inHold ? (
          <>
            {airborne} airborne
            {inHold > 0 ? ` · ${inHold} in the hold` : ""}
          </>
        ) : (
          <span className="text-tower-fg-faint">{sub}</span>
        )}
      </div>
    </>
  );
  return (
    <div className={`${GRID} border-b border-tower-border`}>
      {/* DOMAIN identity — v2 lane anatomy */}
      <div className="border-r border-tower-bright p-2.5">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            title={`Open ${label}`}
            className="group/sp w-full text-left"
          >
            {identity}
          </button>
        ) : (
          <div>{identity}</div>
        )}
      </div>
      {/* 7 state columns */}
      {COLUMNS.map((c) => {
        const cards = inCol(c.key);
        return (
          <div key={c.key} className="min-w-0 border-r border-tower-bright p-1.5">
            {cards.map((it) => (
              <Card key={it.taskId} item={it} />
            ))}
          </div>
        );
      })}
      {/* terminal rail */}
      <div className="min-w-0 p-1.5">
        {terminal.map((it) => (
          <div
            key={it.taskId}
            className="mb-1 rounded-full border border-tower-border bg-tower-render px-2 py-0.5 font-tower-mono text-[8.5px] text-tower-fg-dim"
            title={it.taskId}
          >
            {it.termLabel}
          </div>
        ))}
        {showDropped
          ? dropped.map((it) => (
              <div
                key={it.taskId}
                className="mb-1 rounded-full border border-tower-border px-2 py-0.5 font-tower-mono text-[8.5px] text-tower-fg-faint line-through"
                title={it.taskId}
              >
                dropped
              </div>
            ))
          : null}
      </div>
    </div>
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
  const [showDropped, setShowDropped] = useState(false);
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
  let droppedCount = 0;
  for (const it of queue.data?.items ?? []) {
    const state = it.displayState ?? it.state;
    const { col, termLabel } = place(state);
    if (col === "dropped") droppedCount += 1;
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
  const reportSub = (threadId: string): string => {
    const rep = board.data?.rows.find((b) => b.threadId === threadId)?.report;
    return rep ? `${rep.state}${rep.escalated ? " · mayday" : ""}` : "no report";
  };
  const unassigned = byRow.get(UNASSIGNED) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col font-tower-sans [zoom:0.9]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-tower-border bg-tower-surface px-4 py-2.5">
        <span className={COL_LABEL}>Fleet board · kanban</span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDropped((v) => !v)}
            className={
              "font-tower-mono text-[9px] uppercase tracking-wide " +
              (showDropped ? "text-tower-fg-muted" : "text-tower-fg-faint")
            }
          >
            {showDropped ? "hide" : "show"} dropped ({droppedCount})
          </button>
          <span className="font-tower-mono text-[10px] text-tower-fg-faint">
            {error ? (
              <span className="text-tower-accent-hover">rpc error</span>
            ) : (
              <>live · as of {ageLabel(age)}</>
            )}
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-tower-render">
        {/* column header */}
        <div className={`${GRID} sticky top-0 z-10 border-b border-tower-border bg-tower-header`}>
          <div className="border-r border-tower-header-border px-2.5 py-2">
            <span className={COL_LABEL}>Domain</span>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.key} className="border-r border-tower-header-border px-2 py-2">
              <span className={COL_LABEL + (c.accent ? " !text-tower-accent-hover" : "")}>
                {c.label}
              </span>
            </div>
          ))}
          <div className="px-2 py-2">
            <span className={COL_LABEL}>Terminal</span>
          </div>
        </div>

        {fleet.loading && rows.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">loading crew…</div>
        ) : rows.length === 0 && unassigned.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">
            {scopeThreadId ? "No crew or work under this agent yet." : "No crew yet."}
          </div>
        ) : (
          <>
            {rows.map((r) => (
              <Swimlane
                key={r.threadId}
                label={r.handle ?? r.threadId}
                sub={reportSub(r.threadId)}
                onOpen={() => setFocusedSp(r.threadId)}
                items={byRow.get(r.threadId) ?? []}
                showDropped={showDropped}
              />
            ))}
            {/* the pilot's undispatched pipeline (not yet handed to an SP) */}
            {!scopeThreadId && unassigned.length > 0 ? (
              <Swimlane
                label="Unassigned"
                sub="not yet dispatched"
                items={unassigned}
                showDropped={showDropped}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default FleetOverviewTab;
