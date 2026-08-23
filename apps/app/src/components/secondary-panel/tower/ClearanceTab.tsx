import { useState } from "react";
import { ageLabel, useCrewRpc } from "./useCrewRpc";

const EYEBROW =
  "font-tower-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim";

interface Demand {
  id: number;
  kind: string;
  state: string;
  threadId: string;
  handle: string | null;
  rank: string;
  audience: string;
  title: string;
  body: string;
  whatHappened: string | null;
  atRisk: string | null;
  whatToDo: string | null;
  createdAt: string;
}
interface DemandsResult {
  ok: boolean;
  open: Demand[];
  settled: Demand[];
  waitingOnOthers: Demand[];
  unreadable: { id: number | null; error: string }[];
}

function DemandDetail({ item }: { item: Demand | null }) {
  if (!item) {
    return (
      <div className="grid h-full place-items-center px-6 text-center italic text-tower-fg-faint">
        Select an item on the left to see what it is and what it needs.
      </div>
    );
  }
  return (
    <div className="min-h-0 overflow-y-auto px-6 pb-10 pt-5">
      <div className="mb-1.5">
        <span className={EYEBROW}>
          {item.kind} · from {item.handle ?? item.threadId}
        </span>
      </div>
      <h1 className="mb-[18px] text-[17px] font-semibold tracking-tight text-tower-fg">
        {item.title}
      </h1>
      {item.body ? (
        <div className="mb-[18px] text-tower-fg-body">{item.body}</div>
      ) : null}
      {item.whatHappened ? (
        <div className="mb-[18px]">
          <div className="mb-1.5 font-tower-mono text-[9.5px] uppercase tracking-[0.1em] text-tower-fg-dim">
            What happened
          </div>
          <div className="text-tower-fg-body">{item.whatHappened}</div>
        </div>
      ) : null}
      {item.atRisk ? (
        <div className="mb-[18px]">
          <div className="mb-1.5 font-tower-mono text-[9.5px] uppercase tracking-[0.1em] text-tower-fg-dim">
            At risk
          </div>
          <div className="text-tower-fg-body">{item.atRisk}</div>
        </div>
      ) : null}
      <div className="rounded-[10px] border border-tower-accent bg-tower-accent-tint px-[15px] py-[13px]">
        <div className="mb-1.5 font-tower-mono text-[9.5px] uppercase tracking-[0.1em] text-tower-accent-hover">
          Needs you
        </div>
        <div className="text-tower-fg">
          {item.whatToDo ?? "Clear this demand."}
        </div>
      </div>
    </div>
  );
}

export function ClearanceTab({
  scopeThreadId,
}: {
  /** When set, show only demands raised by this agent (its own clearance). */
  scopeThreadId?: string;
} = {}) {
  const { data, error, loading, ageSeconds } =
    useCrewRpc<DemandsResult>("crew", "crew_demands");
  const open = (data?.open ?? []).filter(
    (d) => !scopeThreadId || d.threadId === scopeThreadId,
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = open.find((d) => d.id === selectedId) ?? open[0] ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col font-tower-sans [zoom:0.9]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-tower-border bg-tower-panel px-4 py-2.5">
        <span className={EYEBROW}>Yours to clear</span>
        <span className="font-tower-mono text-[10px] text-tower-fg-faint">
          {error ? (
            <span className="text-tower-accent-hover">rpc error · {error}</span>
          ) : (
            <>live · crew plugin · as of {ageLabel(ageSeconds)}</>
          )}
        </span>
      </div>

      <div className="@container grid min-h-0 flex-1 grid-cols-[minmax(200px,26%)_1fr]">
        <div className="min-h-0 overflow-y-auto border-r border-tower-border bg-tower-bg px-3 py-3.5">
          {loading && open.length === 0 ? (
            <div className="italic text-tower-fg-faint">loading…</div>
          ) : open.length === 0 ? (
            <div className="italic text-tower-fg-faint">
              Nothing needs you. A clear desk.
            </div>
          ) : (
            open.map((c, idx) => {
              const selectedRow = c.id === (selected?.id ?? -1);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={[
                    "mb-2 flex w-full flex-col gap-1.5 rounded-[10px] border border-tower-border p-3 text-left",
                    selectedRow
                      ? "bg-tower-bright"
                      : "bg-tower-panel hover:bg-tower-bright",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-tower-mono text-[10px] font-bold text-tower-fg-dim">
                      #{idx + 1}
                    </span>
                    <span className="font-semibold text-tower-fg">{c.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full border border-tower-border-strong px-1.5 py-px font-tower-mono text-[9px] uppercase tracking-wide text-tower-fg-dim">
                      {c.kind}
                    </span>
                    <span className="rounded-full border border-tower-border px-1.5 py-px font-tower-mono text-[9px] uppercase tracking-wide text-tower-fg-faint">
                      {c.audience}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <DemandDetail item={selected} />
      </div>
    </div>
  );
}

export default ClearanceTab;
