import { useState } from "react";
import { ageLabel, useCrewRpc } from "./useCrewRpc";

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
}: {
  row: FleetRow;
  report: BoardReport | null;
}) {
  const [draft, setDraft] = useState("");
  const label = row.handle ?? row.threadId;
  return (
    <div className="flex min-w-0 flex-col border-r border-tower-border">
      <div className="flex items-start gap-2.5 px-3.5 pb-2.5 pt-3.5">
        <span className="mt-px rounded-[5px] border border-tower-border-strong px-[5px] py-px font-tower-mono text-[9px] font-bold tracking-wide text-tower-fg-dim">
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-tower-fg">{label}</div>
          <div className="mt-0.5 font-tower-mono text-[10px] text-tower-fg-faint">
            {row.parentThreadId ? `child of ${row.parentThreadId}` : "root pilot"}
          </div>
        </div>
      </div>

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
        className="border-t border-tower-border p-2.5"
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
    <div className="flex min-w-0 flex-col justify-between border-r border-tower-border px-4 py-3.5">
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
            className="rounded-lg border border-tower-border bg-tower-panel px-3 py-2.5 shadow-sm"
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

  const rows = fleet.data?.rows ?? [];
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

  const reportFor = (threadId: string): BoardReport | null =>
    boardRows.find((b) => b.threadId === threadId)?.report ?? null;
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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-tower-border bg-tower-panel px-4 py-2.5">
        <span className={COL_LABEL}>Fleet board</span>
        <span className="font-tower-mono text-[10px] text-tower-fg-faint">
          {error ? (
            <span className="text-tower-accent-hover">rpc error · {error}</span>
          ) : (
            <>live · crew plugin · as of {ageLabel(age)}</>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-tower-bg">
        <div className={`${LANE_GRID} border-b border-tower-border bg-tower-panel`}>
          <div className="border-r border-tower-border px-3.5 py-2"><span className={COL_LABEL}>Domain</span></div>
          <div className="border-r border-tower-border px-4 py-2"><span className={COL_LABEL}>Status</span></div>
          <div className="px-4 py-2"><span className={COL_LABEL}>In flight</span></div>
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
              className={`${LANE_GRID} min-h-[200px] border-b border-tower-border bg-tower-surface transition-colors hover:bg-tower-panel/50`}
            >
              <DomainColumn row={r} report={reportFor(r.threadId)} />
              <StatusColumn report={reportFor(r.threadId)} counts={countsFor(r.threadId)} />
              <InFlightColumn items={inFlightFor(r.threadId)} />
            </div>
          ))
        )}

        {/* unowned work — the QUEUE strip (real work items) */}
        <div className="border-b border-tower-border px-4 py-4">
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
                  className="rounded-[10px] border border-tower-border bg-tower-panel px-3.5 py-3 shadow-sm"
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
