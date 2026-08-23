import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { wsManager } from "@/lib/ws";
import { ageLabel, useCrewRpc } from "./useCrewRpc";
import { SpFocusView } from "./SpFocusView";
import { towerNavAtom } from "./towerNav";

/** Live (non-archived) thread ids — the crew RPC still lists archived threads,
 *  so the board filters against this to drop retired/archived crew. Refetched on
 *  the crew signal so a freshly-ramped SP appears at once. */
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
        /* keep the last known set; a failed refresh must not blank the board */
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
  "font-tower-mono text-[10px] font-bold uppercase tracking-[0.16em] text-tower-fg-dim";
const BLOCK_LABEL =
  "font-tower-mono text-[9px] font-bold uppercase tracking-[0.12em] text-tower-fg-dim";
const LANE_GRID =
  "grid grid-cols-[minmax(240px,26%)_minmax(0,1fr)_minmax(220px,30%)]";

// ---- RPC result shapes (the tolerant fields we actually render) ----
interface FleetRow {
  threadId: string;
  handle: string | null;
  parentThreadId: string | null;
  rank: string;
  reportState: string | null;
  reportNote: string | null;
}
interface FleetResult {
  ok: boolean;
  rows: FleetRow[];
}
interface BoardReport {
  rank: string;
  state: string;
  escalated: boolean;
  note: string;
  at: string;
}
interface BoardRow {
  threadId: string;
  handle: string | null;
  report: BoardReport | null;
}
interface BoardResult {
  ok: boolean;
  rows: BoardRow[];
}
interface WorkAttempt {
  threadId: string;
  paused?: boolean;
  parkedKind?: "pause" | "hold" | null;
}
interface WorkItem {
  taskId: string;
  attempts: WorkAttempt[];
}
interface WorkBoardResult {
  ok: boolean;
  workItems: WorkItem[];
  unnamedWork: { label: string; count: number };
}
interface QueueItem {
  taskId: string;
  title: string;
  intent: string | null;
  state: string;
  displayState: string | null;
}
interface QueueResult {
  ok: boolean;
  items: QueueItem[];
}

const STATE_TONE: Record<string, string> = {
  in_flight: "text-tower-accent-hover",
  in_review: "text-tower-fg-muted",
  accepted: "text-tower-fg-dim",
  queued: "text-tower-fg-dim",
  drafted: "text-tower-fg-faint",
};

/** DOMAIN column — identity, standing, the SP's report stream, a steer composer. */
function DomainColumn({
  row,
  report,
  onOpen,
}: {
  row: FleetRow;
  report: BoardReport | null;
  onOpen: () => void;
}) {
  const [draft, setDraft] = useState("");
  const label = row.handle ?? row.threadId;
  return (
    <div className="flex min-w-0 flex-col border-r border-tower-bright">
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${label}`}
        className="group/sp flex items-start gap-2.5 px-3.5 pb-2.5 pt-3.5 text-left transition-colors hover:bg-tower-bright/50"
      >
        <span className="mt-px rounded-[5px] border border-tower-border-strong px-[5px] py-px font-tower-mono text-[9px] font-bold tracking-wide text-tower-fg-dim">
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-tower-fg group-hover/sp:text-tower-accent-hover">
            {label}
          </div>
          <div className="mt-0.5 font-tower-mono text-[10px] text-tower-fg-faint">
            {row.parentThreadId ? `child of ${row.parentThreadId}` : "root pilot"}
          </div>
        </div>
      </button>

      <div className="min-h-[64px] flex-1 space-y-2.5 overflow-y-auto px-3.5 pb-3">
        {report ? (
          <div>
            <div className={BLOCK_LABEL}>
              {label.toUpperCase()}{" "}
              <span className="text-tower-fg-faint">{report.at}</span>
            </div>
            <div className="mt-0.5 text-[12px] leading-snug text-tower-fg-body">
              {report.note}
            </div>
          </div>
        ) : (
          <div className="pt-1 text-[12px] italic text-tower-fg-faint">
            no transcript yet
          </div>
        )}
      </div>

      <form
        className="border-t border-tower-bright p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          setDraft("");
        }}
      >
        <div className="flex items-center gap-2 rounded-lg border border-tower-input-border bg-tower-input px-3 py-2 transition-colors focus-within:border-tower-fg-dim">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Steer ${label}…`}
            aria-label={`Steer ${label}`}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-tower-fg-body outline-none placeholder:text-tower-fg-faint"
          />
          <button
            type="submit"
            aria-label={`Send to ${label}`}
            className="font-tower-mono text-[11px] text-tower-fg-faint transition-colors hover:text-tower-fg-body"
          >
            ↵
          </button>
        </div>
      </form>
    </div>
  );
}

/** STATUS column — FOCUS (latest report), NEXT, and work-item tallies. */
function StatusColumn({
  report,
  counts,
}: {
  report: BoardReport | null;
  counts: { up: number; approach: number; planned: number; ideas: number };
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between border-r border-tower-bright px-4 py-3.5">
      <div className="space-y-4">
        <div>
          <div className={BLOCK_LABEL}>Focus</div>
          <div className="mt-1 text-[13px] font-medium text-tower-fg">
            {report ? report.note : <span className="italic text-tower-fg-faint">no report yet</span>}
          </div>
          {report ? (
            <div className="mt-0.5 font-tower-mono text-[10px] text-tower-fg-faint">
              {report.state}
              {report.escalated ? " · mayday" : ""} · {report.at}
            </div>
          ) : null}
        </div>
        <div>
          <div className={BLOCK_LABEL}>Next</div>
          <div className="mt-1 text-[13px] italic text-tower-fg-faint">
            not reported
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-tower-mono text-[10px] text-tower-fg-dim">
        <span><span className="text-tower-fg-muted">{counts.up}</span> up</span>
        <span><span className="text-tower-accent-hover">{counts.approach}</span> approach</span>
        <span><span className="text-tower-fg-muted">{counts.planned}</span> planned</span>
        <span><span className="text-tower-fg-muted">{counts.ideas}</span> ideas</span>
      </div>
    </div>
  );
}

/** IN FLIGHT column — dispatched work for this thread; no percentage bars. */
function InFlightColumn({ items }: { items: { taskId: string; state: string; attention?: boolean }[] }) {
  return (
    <div className="min-w-0 space-y-2.5 px-4 py-3.5">
      {items.length === 0 ? (
        <span className="italic text-tower-fg-faint">no in-flight work assigned</span>
      ) : (
        items.map((it) => (
          <div
            key={it.taskId}
            className="rounded-lg border border-tower-bright bg-tower-surface px-3 py-2.5"
          >
            <div className="font-tower-mono text-[10px] font-bold tracking-wide text-tower-fg-muted">
              {it.taskId}
            </div>
            <div
              className={
                "mt-1 font-tower-mono text-[9px] font-bold uppercase tracking-wide " +
                (it.attention ? "text-tower-accent-hover" : "text-tower-fg-dim")
              }
            >
              {it.state.replace(/_/g, " ")}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function FleetOverviewTab() {
  const fleet = useCrewRpc<FleetResult>("crew", "crew_fleet");
  const board = useCrewRpc<BoardResult>("crew", "crew_board");
  const work = useCrewRpc<WorkBoardResult>("crew", "crew_work_board");
  const queue = useCrewRpc<QueueResult>("crew", "crew_queue");

  // The fleet board shows the pilot's CREW — the SPs and CMs under it — not the
  // root pilot threads (the pilot is the left chat), and not archived/retired
  // threads the crew RPC still lists.
  const liveIds = useLiveThreadIds();
  const rows = (fleet.data?.rows ?? []).filter(
    (r) => r.rank !== "PLT" && (liveIds === null || liveIds.has(r.threadId)),
  );
  const boardRows = board.data?.rows ?? [];
  const workItems = work.data?.workItems ?? [];
  const queueItems = queue.data?.items ?? [];
  const age = Math.max(
    fleet.ageSeconds,
    board.ageSeconds,
    work.ageSeconds,
    queue.ageSeconds,
  );
  const error = fleet.error ?? board.error ?? work.error ?? queue.error;

  const [focusedSp, setFocusedSp] = useState<string | null>(null);

  // Chat-link navigation: a bb-tower:sp/<id> link focuses that SP; a plain
  // bb-tower:crew link returns to the board.
  const towerNav = useAtomValue(towerNavAtom);
  const lastNavNonce = useRef(0);
  if (towerNav && towerNav.view === "crew" && towerNav.nonce !== lastNavNonce.current) {
    lastNavNonce.current = towerNav.nonce;
    setFocusedSp(towerNav.spThreadId ?? null);
  }

  const reportFor = (threadId: string): BoardReport | null =>
    boardRows.find((b) => b.threadId === threadId)?.report ?? null;

  if (focusedSp) {
    const r = rows.find((x) => x.threadId === focusedSp);
    return (
      <SpFocusView
        threadId={focusedSp}
        label={r?.handle ?? focusedSp}
        domain={r?.parentThreadId ? "domain lead" : "root pilot"}
        report={reportFor(focusedSp)}
        onBack={() => setFocusedSp(null)}
      />
    );
  }
  const inFlightFor = (threadId: string) =>
    workItems
      .filter((w) => w.attempts.some((a) => a.threadId === threadId))
      .map((w) => ({ taskId: w.taskId, state: "in flight" }));
  const countsFor = (threadId: string) => ({
    up: inFlightFor(threadId).length,
    approach: 0,
    planned: 0,
    ideas: 0,
  });

  return (
    <div className="flex h-full min-h-0 flex-col font-tower-sans">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-tower-border bg-tower-surface px-4 py-2.5">
        <span className={COL_LABEL}>Fleet board</span>
        <span className="font-tower-mono text-[10px] text-tower-fg-faint">
          {error ? (
            <span className="text-tower-accent-hover">rpc error · {error}</span>
          ) : (
            <>live · crew plugin · as of {ageLabel(age)}</>
          )}
        </span>
      </div>

      {/* board sits on the surface tone; each lane is a rounded card with a gap */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-tower-surface p-3">
        {/* column header, once, above the cards */}
        <div className={`${LANE_GRID} px-1 pb-2`}>
          <div className="px-3"><span className={COL_LABEL}>Domain</span></div>
          <div className="px-4"><span className={COL_LABEL}>Status</span></div>
          <div className="px-4"><span className={COL_LABEL}>In flight</span></div>
        </div>

        {fleet.loading && rows.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">loading crew…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">
            No crew threads yet on this instance.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.threadId}
              className={`${LANE_GRID} mb-2.5 min-h-[220px] overflow-hidden rounded-[14px] bg-tower-panel`}
            >
              <DomainColumn
                row={r}
                report={reportFor(r.threadId)}
                onOpen={() => setFocusedSp(r.threadId)}
              />
              <StatusColumn report={reportFor(r.threadId)} counts={countsFor(r.threadId)} />
              <InFlightColumn items={inFlightFor(r.threadId)} />
            </div>
          ))
        )}

        {/* unowned work — its own rounded card */}
        <div className="mb-2.5 rounded-[14px] bg-tower-panel px-4 py-4">
          <div className="mb-2">
            <span className={BLOCK_LABEL}>Queue · unowned · {queueItems.length}</span>
          </div>
          {queueItems.length === 0 ? (
            <span className="italic text-tower-fg-faint">empty — nothing unowned</span>
          ) : (
            <div className="grid grid-cols-1 gap-2 @[720px]:grid-cols-2">
              {queueItems.map((it) => (
                <div
                  key={it.taskId}
                  className="rounded-[10px] border border-tower-bright bg-tower-surface px-3.5 py-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-tower-mono text-[10px] font-bold tracking-wide text-tower-fg-muted">
                      {it.taskId}
                    </span>
                    <span
                      className={
                        "font-tower-mono text-[9px] font-bold uppercase tracking-wide " +
                        (STATE_TONE[it.displayState ?? it.state] ?? "text-tower-fg-dim")
                      }
                    >
                      {(it.displayState ?? it.state).replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] font-medium text-tower-fg">{it.title}</div>
                  {it.intent ? (
                    <div className="mt-0.5 text-[12px] leading-snug text-tower-fg-muted">
                      {it.intent}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FleetOverviewTab;
