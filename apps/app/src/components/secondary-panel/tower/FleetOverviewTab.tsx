import {
  CLEARANCE,
  LANES,
  QUEUE,
  type Lane,
  type WorkItem,
} from "@/views/tower/fixtures";

const STATE_LABEL: Record<WorkItem["state"], string> = {
  queued: "queued",
  in_flight: "in flight",
  in_review: "in review",
  accepted: "accepted",
  dropped: "dropped",
};

function ago(min: number): string {
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

function isStale(lane: Lane): boolean {
  return lane.statusAgeMin > lane.lastActivityMin;
}

function laneNeedsAttention(lane: Lane): boolean {
  return CLEARANCE.some((c) => c.fromLane === lane.id);
}

const EYEBROW =
  "font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim";

function Chips({ items }: { items: readonly WorkItem[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {items.length === 0 ? (
        <span className="italic text-tower-fg-faint">no work items</span>
      ) : (
        items.map((it) => (
          <span
            key={it.taskId}
            className="rounded-full border border-tower-border bg-tower-surface px-2 py-0.5 font-mono text-[10px] text-tower-fg-muted"
          >
            {it.title}{" "}
            <span className="text-tower-fg-faint">· {STATE_LABEL[it.state]}</span>
          </span>
        ))
      )}
    </div>
  );
}

function LaneCard({ lane }: { lane: Lane }) {
  const stale = isStale(lane);
  const attention = laneNeedsAttention(lane);
  const quiet = !attention && lane.lastActivityMin >= 15;
  const dotClass = attention
    ? "bg-tower-accent"
    : quiet
      ? "bg-tower-fg-faint"
      : "bg-tower-fg-dim";
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-tower-border bg-tower-panel p-[15px]">
      <div className="flex items-center gap-2.5">
        <span className="rounded-[5px] border border-tower-border-strong px-[5px] py-px font-mono text-[9px] font-bold tracking-wide text-tower-fg-dim">
          {lane.rank}
        </span>
        <span className="font-semibold text-tower-fg">{lane.name}</span>
        <span className="text-[11px] text-tower-fg-faint">{lane.domain}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10.5px] text-tower-fg-muted">
          <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dotClass}`} />
          {attention ? "needs you" : quiet ? "quiet" : "working"}
        </span>
      </div>

      <div>
        <div className="border-l-2 border-tower-border-strong pl-2.5 text-tower-fg-body">
          {lane.statusLine}
        </div>
        <div
          className={`mt-[3px] font-mono text-[10px] ${
            stale ? "text-tower-accent-hover" : "text-tower-fg-faint"
          }`}
        >
          {stale
            ? `stated ${ago(lane.statusAgeMin)} · stale (active ${ago(lane.lastActivityMin)})`
            : `stated ${ago(lane.statusAgeMin)}`}
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-[3px] text-[12px]">
        <span className="pt-0.5 font-mono text-[9.5px] uppercase tracking-wide text-tower-fg-dim">
          Focus
        </span>
        <span className="text-tower-fg-body">{lane.focus}</span>
        <span className="pt-0.5 font-mono text-[9.5px] uppercase tracking-wide text-tower-fg-dim">
          Next
        </span>
        <span
          className={lane.next ? "text-tower-fg-body" : "italic text-tower-fg-faint"}
        >
          {lane.next ?? "nothing queued"}
        </span>
      </div>

      <Chips items={lane.items} />
    </div>
  );
}

export function FleetOverviewTab() {
  return (
    <div className="@container h-full overflow-y-auto px-4 pb-10 pt-4">
      <p className="mb-4 text-[11.5px] text-tower-fg-dim">
        Every domain SP and what is on its mind, right now. Status lines are
        self-authored and stamped per turn; a line older than the lane&apos;s
        last move is marked stale, never trusted.
      </p>
      <div className="grid grid-cols-1 gap-3 @[720px]:grid-cols-2">
        {LANES.map((lane) => (
          <LaneCard key={lane.id} lane={lane} />
        ))}
      </div>

      <div className="mt-4 rounded-[10px] border border-dashed border-tower-border-strong bg-tower-panel px-[15px] py-3">
        <div className="mb-2">
          <span className={EYEBROW}>Queue · unowned</span>
        </div>
        {QUEUE.length === 0 ? (
          <span className="italic text-tower-fg-faint">
            empty — nothing unowned
          </span>
        ) : (
          <Chips items={QUEUE} />
        )}
      </div>
    </div>
  );
}

export default FleetOverviewTab;
