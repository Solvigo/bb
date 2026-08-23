import { useState } from "react";
import { ageLabel, useCrewRpc } from "./useCrewRpc";

/**
 * Knowledge tab — the project's knowledge, organised the way it is owned:
 *   • each THEME is a domain/SP's responsibility — a curated SUMMARY (the
 *     theme's `…/board` head) plus its knowledge ENTRIES.
 *   • the PILOT curates a PROJECT overview across every theme's summary.
 * Reads the knowledge plugin's composition RPC live. Left: project + themes.
 * Right: the selected theme's curated summary and its entries (or the project
 * overview); an entry expands to its current truth.
 */
const MONO_LABEL =
  "font-tower-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim";
const KIND_TONE: Record<string, string> = {
  decision: "text-tower-accent-hover",
  constraint: "text-tower-accent-hover",
  learning: "text-tower-fg-muted",
  reference: "text-tower-fg-dim",
  fact: "text-tower-fg-dim",
  doc: "text-tower-fg-dim",
};

interface GroupRow {
  group: string;
  theme: string;
  heads: number;
  curator: string | null;
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
  staleness: { newerHeads: number } | null;
}
interface GroupHeadsResult {
  ok: boolean;
  curator: string | null;
  heads: HeadSummary[];
}
interface HeadResult {
  ok: boolean;
  present: boolean;
  head: { body: string; author: string | null; date: string | null } | null;
}

const PROJECT = "__project__";

/** The board head for a theme (its curated summary), or the project overview. */
function boardSubject(theme: string): string {
  return theme === PROJECT ? "project/overview" : `theme:${theme}/board`;
}

function SummaryBlock({ theme, curator }: { theme: string; curator: string | null }) {
  const { data } = useCrewRpc<HeadResult>("knowledge", "knowledge_head", {
    subject: boardSubject(theme),
  });
  const body = data?.present ? data.head?.body?.trim() : null;
  const who = theme === PROJECT ? "the pilot" : (curator ?? "its curator");
  return (
    <div className="mb-5 rounded-[12px] border border-tower-border bg-tower-panel px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className={MONO_LABEL}>
          {theme === PROJECT ? "Project overview" : "Curated summary"}
        </span>
        {data?.head?.date ? (
          <span className="font-tower-mono text-[9px] text-tower-fg-faint">
            {who} · {data.head.date.slice(0, 10)}
          </span>
        ) : null}
      </div>
      {body ? (
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-tower-fg-body">
          {body}
        </div>
      ) : (
        <div className="text-[12px] italic text-tower-fg-faint">
          Not yet curated by {who}.
        </div>
      )}
    </div>
  );
}

function EntryBody({ subject }: { subject: string }) {
  const { data, loading } = useCrewRpc<HeadResult>("knowledge", "knowledge_head", {
    subject,
  });
  if (loading && !data) {
    return <div className="px-3 pb-3 text-[12px] italic text-tower-fg-faint">loading…</div>;
  }
  return (
    <div className="whitespace-pre-wrap px-3 pb-3 text-[12px] leading-relaxed text-tower-fg-body">
      {data?.head?.body?.trim()}
    </div>
  );
}

function ThemeDetail({ theme, curator }: { theme: string; curator: string | null }) {
  const headsRpc = useCrewRpc<GroupHeadsResult>(
    "knowledge",
    "knowledge_group_heads",
    { group: `theme:${theme}` },
  );
  // Entries are the theme's heads minus the `board` head (that IS the summary).
  const entries = (headsRpc.data?.heads ?? []).filter((h) => h.slug !== "board");
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="min-h-0 overflow-y-auto px-5 pb-10 pt-4">
      <h1 className="mb-3 font-tower-mono text-[15px] font-semibold tracking-tight text-tower-fg">
        {theme}
      </h1>
      <SummaryBlock theme={theme} curator={curator} />
      <div className={`${MONO_LABEL} mb-2`}>Entries · {entries.length}</div>
      {entries.length === 0 ? (
        <div className="text-[12px] italic text-tower-fg-faint">
          No entries recorded for this theme.
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((h) => {
            const on = h.subject === open;
            return (
              <li
                key={h.subject}
                className="overflow-hidden rounded-[10px] border border-tower-border bg-tower-render"
              >
                <button
                  type="button"
                  onClick={() => setOpen(on ? null : h.subject)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-tower-panel"
                >
                  <span
                    className={`font-tower-mono text-[8.5px] font-bold uppercase tracking-wide ${KIND_TONE[h.kind] ?? "text-tower-fg-dim"}`}
                  >
                    {h.kind}
                  </span>
                  <span className="font-tower-mono text-[12px] text-tower-fg-body">
                    {h.slug}
                  </span>
                  {h.staleness && h.staleness.newerHeads > 0 ? (
                    <span className="font-tower-mono text-[8.5px] uppercase text-tower-accent-hover">
                      stale
                    </span>
                  ) : null}
                  <span className="ml-auto font-tower-mono text-[10px] text-tower-fg-faint">
                    {on ? "–" : "+"}
                  </span>
                </button>
                {on ? <EntryBody subject={h.subject} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function KnowledgeTab() {
  const groupsRpc = useCrewRpc<GroupIndexResult>(
    "knowledge",
    "knowledge_group_index",
  );
  const groups = groupsRpc.data?.groups ?? [];
  const themes = groups
    .filter((g) => g.group.startsWith("theme:"))
    .map((g) => ({ theme: g.theme, heads: g.heads, curator: g.curator }));

  const [sel, setSel] = useState<string>(PROJECT);
  const selCurator = themes.find((t) => t.theme === sel)?.curator ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-render font-tower-sans [zoom:0.9]">
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

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(200px,26%)_1fr]">
        <div className="min-h-0 overflow-y-auto border-r border-tower-border bg-tower-bg px-3 py-3.5">
          {/* PROJECT — the pilot's cross-theme overview */}
          <button
            type="button"
            onClick={() => setSel(PROJECT)}
            className={
              "mb-3 flex w-full items-center gap-2 rounded-[9px] border border-tower-border px-3 py-2.5 text-left " +
              (sel === PROJECT ? "bg-tower-bright" : "bg-tower-panel hover:bg-tower-bright")
            }
          >
            <span className="font-tower-mono text-[11px] font-bold tracking-wide text-tower-fg">
              Project
            </span>
            <span className="ml-auto font-tower-mono text-[9px] text-tower-fg-faint">
              pilot
            </span>
          </button>

          <div className={`${MONO_LABEL} mb-2 px-1`}>Themes · {themes.length}</div>
          {themes.length === 0 ? (
            <div className="px-1 text-[12px] italic text-tower-fg-faint">
              No themes yet.
            </div>
          ) : (
            themes.map((t) => {
              const on = t.theme === sel;
              return (
                <button
                  key={t.theme}
                  type="button"
                  onClick={() => setSel(t.theme)}
                  className={
                    "mb-1.5 flex w-full flex-col gap-0.5 rounded-[9px] border border-tower-border px-3 py-2.5 text-left " +
                    (on ? "bg-tower-bright" : "bg-tower-panel hover:bg-tower-bright")
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="font-tower-mono text-[12px] font-bold tracking-wide text-tower-fg">
                      {t.theme}
                    </span>
                    <span className="ml-auto font-tower-mono text-[9px] text-tower-fg-faint">
                      {t.heads}
                    </span>
                  </span>
                  <span className="font-tower-mono text-[9px] text-tower-fg-faint">
                    {t.curator ?? "no curator"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {sel === PROJECT ? (
          <div className="min-h-0 overflow-y-auto px-5 pb-10 pt-4">
            <h1 className="mb-3 font-tower-mono text-[15px] font-semibold tracking-tight text-tower-fg">
              Project overview
            </h1>
            <SummaryBlock theme={PROJECT} curator={null} />
            <div className="text-[12px] italic text-tower-fg-faint">
              The pilot curates this across every theme&apos;s summary. Pick a theme
              on the left to read a domain&apos;s own curated truth and entries.
            </div>
          </div>
        ) : (
          <ThemeDetail theme={sel} curator={selCurator} />
        )}
      </div>
    </div>
  );
}

export default KnowledgeTab;
