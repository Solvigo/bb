import { useState } from "react";
import { CLEARANCE, type ClearanceItem } from "@/views/tower/fixtures";

const EYEBROW =
  "font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim";

function ClearanceDetail({ item }: { item: ClearanceItem | null }) {
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
          {item.kind} · from {item.fromLane}
        </span>
      </div>
      <h1 className="mb-[18px] text-[17px] font-semibold tracking-tight text-tower-fg">
        {item.title}
      </h1>

      <div className="mb-[18px]">
        <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-tower-fg-dim">
          What was done
        </div>
        <div className="text-tower-fg-body">{item.detail.whatWasDone}</div>
      </div>
      <div className="mb-[18px]">
        <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-tower-fg-dim">
          Result
        </div>
        <div className="text-tower-fg-body">{item.detail.result}</div>
      </div>
      {(item.detail.prUrl || item.detail.sealedSha) && (
        <div className="mb-[18px]">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-tower-fg-dim">
            Deliverable
          </div>
          <div className="font-mono text-[11px] text-tower-fg-faint">
            PR: {item.detail.prUrl ?? "—"} · sealed sha:{" "}
            {item.detail.sealedSha ?? "—"}
          </div>
        </div>
      )}
      <div className="rounded-[10px] border border-tower-accent bg-tower-accent-tint px-[15px] py-[13px]">
        <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-tower-accent-hover">
          Needs you
        </div>
        <div className="text-tower-fg">{item.detail.ask}</div>
      </div>
    </div>
  );
}

export function ClearanceTab() {
  const [selectedId, setSelectedId] = useState<string | null>(
    CLEARANCE[0]?.id ?? null,
  );
  const selected = CLEARANCE.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="@container grid h-full grid-cols-[minmax(240px,34%)_1fr] @[560px]:grid-cols-[minmax(240px,34%)_1fr]">
      <div className="min-h-0 overflow-y-auto border-r border-tower-border px-3 py-3.5">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <span className={EYEBROW}>Yours to clear</span>
          <span className={EYEBROW}>{CLEARANCE.length}</span>
        </div>
        {CLEARANCE.length === 0 ? (
          <div className="italic text-tower-fg-faint">
            Nothing needs you. A clear desk.
          </div>
        ) : (
          CLEARANCE.map((c) => {
            const selectedRow = c.id === selectedId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={[
                  "mb-2 flex w-full flex-col gap-1.5 rounded-[10px] border p-3 text-left",
                  c.rank === 1
                    ? "border-l-2 border-l-tower-accent border-tower-border"
                    : "border-tower-border",
                  selectedRow ? "bg-tower-bright" : "bg-tower-panel hover:bg-tower-bright",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-[10px] font-bold ${
                      c.rank === 1 ? "text-tower-accent" : "text-tower-fg-dim"
                    }`}
                  >
                    #{c.rank}
                  </span>
                  <span className="font-semibold text-tower-fg">{c.title}</span>
                </div>
                <div className="text-[11.5px] text-tower-fg-muted">
                  {c.rationale}
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded-full border px-1.5 py-px font-mono text-[9px] uppercase tracking-wide ${
                      c.vetted
                        ? "border-tower-border-strong text-tower-fg-muted"
                        : "border-tower-border italic text-tower-fg-faint"
                    }`}
                  >
                    {c.vetted ? "vetted" : "unvetted"}
                  </span>
                  <span className="rounded-full border border-tower-border-strong px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-tower-fg-dim">
                    {c.kind}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
      <ClearanceDetail item={selected} />
    </div>
  );
}

export default ClearanceTab;
