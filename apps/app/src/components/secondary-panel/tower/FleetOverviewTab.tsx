import { ageLabel, useCrewRpc } from "./useCrewRpc";

const COL_LABEL =
  "font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-tower-fg-dim";
const BLOCK_LABEL =
  "font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-tower-fg-dim";

interface FleetRow {
  threadId: string;
  handle: string | null;
  parentThreadId: string | null;
  rank: string;
  rankError: string | null;
  reportState: string | null;
  reportNote: string | null;
}
interface FleetResult {
  ok: boolean;
  rows: FleetRow[];
  unreadable: { threadId: string | null; error: string }[];
}

interface QueueItem {
  taskId: string;
  title: string;
  intent: string | null;
  acceptance: string | null;
  state: string;
  displayState: string | null;
  dispatchable: boolean;
  blockedBecause: string | null;
  createdBy: string | null;
}
interface QueueResult {
  ok: boolean;
  items: QueueItem[];
  unreadable: { id: string | number | null; error: string }[];
}

const STATE_TONE: Record<string, string> = {
  in_flight: "text-tower-accent-hover",
  in_review: "text-tower-fg-muted",
  accepted: "text-tower-fg-dim",
  queued: "text-tower-fg-dim",
  drafted: "text-tower-fg-faint",
  dropped: "text-tower-fg-faint",
};

function LiveStamp({ age, error }: { age: number; error: string | null }) {
  return (
    <span className="font-mono text-[10px] text-tower-fg-faint">
      {error ? (
        <span className="text-tower-accent-hover">rpc error · {error}</span>
      ) : (
        <>live · crew plugin · as of {ageLabel(age)}</>
      )}
    </span>
  );
}

function LaneRow({ row }: { row: FleetRow }) {
  const label = row.handle ?? row.threadId;
  return (
    <div className="group/lane grid grid-cols-[minmax(240px,26%)_minmax(0,1fr)_minmax(220px,30%)] min-h-[120px] border-b border-tower-border bg-tower-surface transition-colors hover:bg-tower-panel/60">
      <div className="flex flex-col gap-2 border-r border-tower-border px-3.5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-[5px] border border-tower-border-strong px-[5px] py-px font-mono text-[9px] font-bold tracking-wide text-tower-fg-dim">
            {row.rank}
          </span>
          <span className="truncate font-semibold text-tower-fg">{label}</span>
        </div>
        <div className="font-mono text-[10px] text-tower-fg-faint">
          {row.parentThreadId ? `child of ${row.parentThreadId}` : "root pilot"}
        </div>
      </div>
      <div className="flex flex-col justify-center border-r border-tower-border px-4 py-3.5">
        <div className={BLOCK_LABEL}>Report</div>
        <div className="mt-1 text-[13px] text-tower-fg-body">
          {row.reportState ? (
            <>
              {row.reportState}
              {row.reportNote ? (
                <span className="text-tower-fg-muted"> — {row.reportNote}</span>
              ) : null}
            </>
          ) : (
            <span className="italic text-tower-fg-faint">no report yet</span>
          )}
        </div>
        {row.rankError ? (
          <div className="mt-1 font-mono text-[10px] text-tower-accent-hover">
            rank: {row.rankError}
          </div>
        ) : null}
      </div>
      <div className="px-4 py-3.5">
        <span className="italic text-tower-fg-faint">
          no in-flight work assigned
        </span>
      </div>
    </div>
  );
}

export function FleetOverviewTab() {
  const fleet = useCrewRpc<FleetResult>("crew", "crew_fleet");
  const queue = useCrewRpc<QueueResult>("crew", "crew_queue");

  const rows = fleet.data?.rows ?? [];
  const items = queue.data?.items ?? [];
  const age = Math.max(fleet.ageSeconds, queue.ageSeconds);
  const error = fleet.error ?? queue.error;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header + honest live stamp */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-tower-border bg-tower-panel px-4 py-2.5">
        <span className={COL_LABEL}>Crew overview</span>
        <LiveStamp age={age} error={error} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-tower-bg">
        {/* column header */}
        <div className="grid grid-cols-[minmax(240px,26%)_minmax(0,1fr)_minmax(220px,30%)] border-b border-tower-border bg-tower-panel">
          <div className="border-r border-tower-border px-3.5 py-2">
            <span className={COL_LABEL}>Domain</span>
          </div>
          <div className="border-r border-tower-border px-4 py-2">
            <span className={COL_LABEL}>Status</span>
          </div>
          <div className="px-4 py-2">
            <span className={COL_LABEL}>In flight</span>
          </div>
        </div>

        {/* real crew threads as lanes */}
        {fleet.loading && rows.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">loading crew…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 italic text-tower-fg-faint">
            No crew threads yet on this instance.
          </div>
        ) : (
          rows.map((r) => <LaneRow key={r.threadId} row={r} />)
        )}

        {/* real work items from the crew ledger */}
        <div className="px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className={BLOCK_LABEL}>
              Work items · {items.length}
            </span>
          </div>
          {queue.loading && items.length === 0 ? (
            <div className="italic text-tower-fg-faint">loading work items…</div>
          ) : items.length === 0 ? (
            <div className="italic text-tower-fg-faint">no work items</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 @[720px]:grid-cols-2">
              {items.map((it) => (
                <div
                  key={it.taskId}
                  className="rounded-[10px] border border-tower-border bg-tower-panel px-3.5 py-3 shadow-sm"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[10px] font-bold tracking-wide text-tower-fg-muted">
                      {it.taskId}
                    </span>
                    <span
                      className={
                        "font-mono text-[9px] font-bold uppercase tracking-wide " +
                        (STATE_TONE[it.displayState ?? it.state] ??
                          "text-tower-fg-dim")
                      }
                    >
                      {(it.displayState ?? it.state).replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] font-medium text-tower-fg">
                    {it.title}
                  </div>
                  {it.intent ? (
                    <div className="mt-0.5 text-[12px] leading-snug text-tower-fg-muted">
                      {it.intent}
                    </div>
                  ) : null}
                  {it.blockedBecause ? (
                    <div className="mt-1 font-mono text-[10px] text-tower-fg-faint">
                      {it.blockedBecause}
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
