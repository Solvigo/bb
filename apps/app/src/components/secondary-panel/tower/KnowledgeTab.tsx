import { useEffect, useState } from "react";
import { ageLabel, useCrewRpc } from "./useCrewRpc";

/**
 * Knowledge tab — the per-home knowledge store: keyed HEADS (current truth per
 * subject, theme-grouped) plus an append-only HISTORY. Reads the knowledge
 * plugin's composition RPC live (refetch on its realtime signal). Master-detail:
 * themes + their heads on the left, the selected head's current body + its
 * provenance history on the right.
 */
const MONO_LABEL =
  "font-tower-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim";

interface GroupRow {
  group: string;
  theme: string;
  heads: number;
}
interface GroupIndexResult {
  ok: boolean;
  groups: GroupRow[];
}
interface HeadSummary {
  subject: string;
  slug: string;
  kind: string;
  status: string | null;
  author: string | null;
  date: string | null;
  staleness: { newerHeads: number } | null;
}
interface GroupHeadsResult {
  ok: boolean;
  group: string;
  heads: HeadSummary[];
}
interface HeadDetail {
  slug: string;
  kind: string;
  status: string | null;
  author: string | null;
  date: string | null;
  body: string;
  staleness: { newerHeads: number } | null;
}
interface HistoryRow {
  version: number;
  kind: string;
  author: string | null;
  date: string | null;
  excerpt: string;
}
interface HeadResult {
  ok: boolean;
  present: boolean;
  subject: string;
  head: HeadDetail;
  history: HistoryRow[];
}

const KIND_TONE: Record<string, string> = {
  decision: "text-tower-accent-hover",
  constraint: "text-tower-accent-hover",
  learning: "text-tower-fg-muted",
  reference: "text-tower-fg-dim",
  fact: "text-tower-fg-dim",
  doc: "text-tower-fg-dim",
};

function HeadDetailView({ subject }: { subject: string | null }) {
  const { data, loading } = useCrewRpc<HeadResult>("knowledge", "knowledge_head", {
    subject: subject ?? "",
  });
  if (!subject) {
    return (
      <div className="grid h-full place-items-center px-6 text-center italic text-tower-fg-faint">
        Select an entry to read its current truth and history.
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="grid h-full place-items-center italic text-tower-fg-faint">
        loading…
      </div>
    );
  }
  const head = data?.head;
  const history = data?.history ?? [];
  return (
    <div className="min-h-0 overflow-y-auto px-6 pb-10 pt-5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`font-tower-mono text-[10px] font-bold uppercase tracking-[0.14em] ${KIND_TONE[head?.kind ?? ""] ?? "text-tower-fg-dim"}`}>
          {head?.kind}
        </span>
        {head?.status ? (
          <span className="rounded-full border border-tower-border-strong px-1.5 py-px font-tower-mono text-[9px] uppercase tracking-wide text-tower-fg-dim">
            {head.status}
          </span>
        ) : null}
        {head?.staleness && head.staleness.newerHeads > 0 ? (
          <span className="font-tower-mono text-[9px] uppercase tracking-wide text-tower-accent-hover">
            stale · {head.staleness.newerHeads} newer
          </span>
        ) : null}
      </div>
      <h1 className="mb-[14px] font-tower-mono text-[15px] font-semibold tracking-tight text-tower-fg">
        {head?.slug ?? subject}
      </h1>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-tower-fg-body">
        {head?.body?.trim()}
      </div>
      <div className="mt-3 font-tower-mono text-[10px] text-tower-fg-faint">
        {head?.author}
        {head?.date ? ` · v-current · ${head.date.slice(0, 10)}` : ""}
      </div>

      {history.length > 1 ? (
        <div className="mt-6">
          <div className={MONO_LABEL}>History · {history.length}</div>
          <ul className="mt-2 space-y-2">
            {history.map((h) => (
              <li
                key={h.version}
                className="rounded-[8px] border border-tower-border bg-tower-panel px-3 py-2"
              >
                <div className="flex items-baseline gap-2 font-tower-mono text-[9px] uppercase tracking-wide text-tower-fg-dim">
                  <span className="text-tower-fg-muted">v{h.version}</span>
                  <span>{h.kind}</span>
                  <span className="text-tower-fg-faint">{h.author}</span>
                  {h.date ? (
                    <span className="ml-auto text-tower-fg-faint">
                      {h.date.slice(0, 10)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[12px] leading-snug text-tower-fg-muted">
                  {h.excerpt}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeTab() {
  const groupsRpc = useCrewRpc<GroupIndexResult>(
    "knowledge",
    "knowledge_group_index",
  );
  const groups = groupsRpc.data?.groups ?? [];
  const [group, setGroup] = useState<string | null>(null);
  const activeGroup = group ?? groups[0]?.group ?? null;

  const headsRpc = useCrewRpc<GroupHeadsResult>(
    "knowledge",
    "knowledge_group_heads",
    { group: activeGroup ?? "" },
  );
  const heads = activeGroup ? headsRpc.data?.heads ?? [] : [];

  const [subject, setSubject] = useState<string | null>(null);
  const selected = heads.some((h) => h.subject === subject)
    ? subject
    : heads[0]?.subject ?? null;
  // keep the detail in step when the head list changes under us
  useEffect(() => {
    if (subject && !heads.some((h) => h.subject === subject)) setSubject(null);
  }, [heads, subject]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-surface font-tower-sans">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-tower-border bg-tower-panel px-4 py-2.5">
        <span className={MONO_LABEL}>Knowledge · current truth</span>
        <span className="font-tower-mono text-[10px] text-tower-fg-faint">
          {groupsRpc.error ? (
            <span className="text-tower-accent-hover">rpc error</span>
          ) : (
            <>live · knowledge plugin · as of {ageLabel(groupsRpc.ageSeconds)}</>
          )}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,30%)_1fr]">
        <div className="min-h-0 overflow-y-auto border-r border-tower-border bg-tower-bg px-3 py-3.5">
          {groups.length === 0 ? (
            <div className="italic text-tower-fg-faint">
              No knowledge recorded yet.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.group} className="mb-3">
                <button
                  type="button"
                  onClick={() => setGroup(g.group)}
                  className={
                    "mb-1.5 flex w-full items-baseline justify-between px-1 " +
                    (g.group === activeGroup ? "" : "opacity-70")
                  }
                >
                  <span className="font-tower-mono text-[11px] font-bold tracking-wide text-tower-fg">
                    {g.theme}
                  </span>
                  <span className="font-tower-mono text-[9px] text-tower-fg-faint">
                    {g.heads}
                  </span>
                </button>
                {g.group === activeGroup
                  ? heads.map((h) => {
                      const on = h.subject === selected;
                      return (
                        <button
                          key={h.subject}
                          type="button"
                          onClick={() => setSubject(h.subject)}
                          className={
                            "mb-1 flex w-full flex-col gap-1 rounded-[9px] border border-tower-border p-2.5 text-left " +
                            (on
                              ? "bg-tower-bright"
                              : "bg-tower-panel hover:bg-tower-bright")
                          }
                        >
                          <span className="font-tower-mono text-[11px] text-tower-fg-body">
                            {h.slug}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`font-tower-mono text-[8.5px] font-bold uppercase tracking-wide ${KIND_TONE[h.kind] ?? "text-tower-fg-dim"}`}
                            >
                              {h.kind}
                            </span>
                            {h.staleness && h.staleness.newerHeads > 0 ? (
                              <span className="font-tower-mono text-[8.5px] uppercase text-tower-accent-hover">
                                stale
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })
                  : null}
              </div>
            ))
          )}
        </div>
        <HeadDetailView subject={selected} />
      </div>
    </div>
  );
}

export default KnowledgeTab;
