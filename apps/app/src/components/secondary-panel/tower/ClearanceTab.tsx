import { useState } from "react";
import { ageLabel, useCrewRpc } from "./useCrewRpc";

const EYEBROW =
  "font-tower-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim";

type SettleAction = "answer" | "defer" | "moot" | "withdraw";
const SETTLE_ACTIONS: { action: SettleAction; label: string; primary?: boolean }[] = [
  { action: "answer", label: "Answer", primary: true },
  { action: "defer", label: "Defer" },
  { action: "moot", label: "Moot" },
  { action: "withdraw", label: "Withdraw" },
];

async function settleDemand(
  id: number,
  action: SettleAction,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/v1/plugins/crew/rpc/crew_demand_settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, action, text }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    result?: { ok?: boolean; error?: string };
    error?: { message?: string };
  };
  if (json.ok && json.result?.ok !== false)
    return { ok: true };
  return {
    ok: false,
    error: json.result?.error ?? json.error?.message ?? "settle refused",
  };
}

/** The operator's settle controls on a demand — the attention surface CLEARS things. */
function SettleControls({ item }: { item: Demand }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<SettleAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: SettleAction) => {
    if (action === "answer" && !text.trim()) {
      setError("An answer needs a line.");
      return;
    }
    setBusy(action);
    setError(null);
    const r = await settleDemand(item.id, action, text.trim());
    setBusy(null);
    if (r.ok) {
      setText("");
    } else {
      setError(r.error ?? "refused");
    }
  };
  return (
    <div className="mt-5 border-t border-tower-border pt-4">
      <div className={`${EYEBROW} mb-2`}>Clear it</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your answer (or a one-line why for defer / moot / withdraw)…"
        className="mb-2 h-16 w-full resize-none rounded-lg border border-tower-input-border bg-tower-input px-3 py-2 text-[12px] text-tower-fg-body outline-none placeholder:text-tower-fg-faint focus:border-tower-fg-dim"
      />
      {error ? (
        <div className="mb-2 font-tower-mono text-[10px] text-tower-accent-hover">
          refused · {error}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {SETTLE_ACTIONS.map((a) => (
          <button
            key={a.action}
            type="button"
            disabled={busy !== null}
            onClick={() => void run(a.action)}
            className={
              "rounded-md border px-2.5 py-1 font-tower-mono text-[10px] uppercase tracking-wide disabled:opacity-40 " +
              (a.primary
                ? "border-tower-accent bg-tower-accent-tint text-tower-accent-hover"
                : "border-tower-border text-tower-fg-dim hover:bg-tower-bright")
            }
          >
            {busy === a.action ? "…" : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

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
      <SettleControls item={item} />
    </div>
  );
}

export function ClearanceTab({
  scopeThreadId,
}: {
  /** When set, show only demands raised by this agent (its own clearance). */
  scopeThreadId?: string;
} = {}) {
  const { data, error, loading, timedOut, ageSeconds } =
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
          ) : timedOut && open.length === 0 ? (
            // "A clear desk" is a strong claim. Never make it on a read that
            // never came back — an unanswered question is not an empty one.
            <div className="italic text-tower-fg-faint">
              No answer yet, so this may not be everything.
            </div>
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
