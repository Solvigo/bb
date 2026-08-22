import { LANES, type Lane } from "@/views/tower/fixtures";

const COL_LABEL =
  "font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-tower-fg-dim";
const BLOCK_LABEL =
  "font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-tower-fg-dim";

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

/** DOMAIN column: identity, standing, streamed transcript, steer composer. */
function DomainColumn({ lane }: { lane: Lane }) {
  const stale = isStale(lane);
  return (
    <div className="flex min-w-0 flex-col border-r border-tower-border">
      <div className="flex items-start gap-2.5 px-3.5 pb-2.5 pt-3.5">
        <span className="mt-px rounded-[5px] border border-tower-border-strong px-[5px] py-px font-mono text-[9px] font-bold tracking-wide text-tower-fg-dim">
          {lane.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-tower-fg">
              {lane.name}
            </span>
            {lane.heldCount > 0 ? (
              <span className="rounded-full bg-tower-accent-tint px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide text-tower-accent-hover">
                {lane.heldCount} held
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-tower-fg-faint">
            {lane.standing}
          </div>
        </div>
      </div>

      {/* streamed transcript (truncated, never summarised) */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 pb-3">
        {lane.transcript.map((line, i) => (
          <div key={i}>
            <div className={BLOCK_LABEL}>
              {line.author} <span className="text-tower-fg-faint">{line.at}</span>
            </div>
            <div className="mt-0.5 text-[12px] leading-snug text-tower-fg-body">
              {line.text}
            </div>
          </div>
        ))}
        {stale ? (
          <div className="font-mono text-[10px] text-tower-accent-hover">
            status line stated {ago(lane.statusAgeMin)} · stale (active{" "}
            {ago(lane.lastActivityMin)})
          </div>
        ) : null}
      </div>

      {/* steer composer (visual for now) */}
      <div className="border-t border-tower-border p-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-tower-input-border bg-tower-input px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-tower-fg-faint">
            Steer {lane.name}…
          </span>
          <span className="font-mono text-[11px] text-tower-fg-faint">↵</span>
        </div>
      </div>
    </div>
  );
}

/** STATUS column: FOCUS, NEXT, and the work-item state tallies footer. */
function StatusColumn({ lane }: { lane: Lane }) {
  return (
    <div className="flex min-w-0 flex-col justify-between border-r border-tower-border px-4 py-3.5">
      <div className="space-y-4">
        <div>
          <div className={BLOCK_LABEL}>Focus</div>
          <div className="mt-1 text-[13px] font-medium text-tower-fg">
            {lane.focus}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-tower-fg-faint">
            {lane.focusMeta}
          </div>
        </div>
        <div>
          <div className={BLOCK_LABEL}>Next</div>
          <div
            className={
              "mt-1 text-[13px] " +
              (lane.next ? "text-tower-fg-body" : "italic text-tower-fg-faint")
            }
          >
            {lane.next ?? "nothing queued"}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-tower-fg-faint">
            {lane.nextMeta}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-tower-fg-dim">
        <span>
          <span className="text-tower-fg-muted">{lane.counts.up}</span> up
        </span>
        <span>
          <span className="text-tower-accent-hover">{lane.counts.approach}</span>{" "}
          approach
        </span>
        <span>
          <span className="text-tower-fg-muted">{lane.counts.planned}</span> planned
        </span>
        <span>
          <span className="text-tower-fg-muted">{lane.counts.ideas}</span> ideas
        </span>
      </div>
    </div>
  );
}

/** IN FLIGHT column: work items with a note and state — no percentage bars. */
function InFlightColumn({ lane }: { lane: Lane }) {
  return (
    <div className="min-w-0 space-y-2.5 px-4 py-3.5">
      {lane.inFlight.length === 0 ? (
        <span className="italic text-tower-fg-faint">nothing in flight</span>
      ) : (
        lane.inFlight.map((it) => (
          <div
            key={it.code}
            className="rounded-lg border border-tower-border bg-tower-panel px-3 py-2.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] font-bold tracking-wide text-tower-fg-muted">
                {it.code}
              </span>
              <span className="font-mono text-[10px] text-tower-fg-faint">
                {it.ageLabel}
              </span>
            </div>
            <div className="mt-1 text-[12px] leading-snug text-tower-fg-body">
              {it.note}
            </div>
            <div
              className={
                "mt-1.5 font-mono text-[9px] font-bold uppercase tracking-wide " +
                (it.attention ? "text-tower-accent-hover" : "text-tower-fg-dim")
              }
            >
              {it.state}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const LANE_GRID = "grid grid-cols-[minmax(240px,26%)_minmax(0,1fr)_minmax(220px,30%)]";

export function FleetOverviewTab() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* fixed column header */}
      <div className={`${LANE_GRID} shrink-0 border-b border-tower-border px-0`}>
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

      {/* swimlanes, one per SP */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {LANES.map((lane) => (
          <div
            key={lane.id}
            className={`${LANE_GRID} min-h-[220px] border-b border-tower-border`}
          >
            <DomainColumn lane={lane} />
            <StatusColumn lane={lane} />
            <InFlightColumn lane={lane} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default FleetOverviewTab;
