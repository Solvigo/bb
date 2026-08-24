import { useEffect, useState } from "react";
import { wsManager } from "@/lib/ws";

export interface CrewLead {
  threadId: string;
  name: string;
  /** the lead's own last report, when the crew plugin has one */
  status: string | null;
  working: boolean;
}

export interface Crew {
  /** the commander thread — the root the Captain talks to */
  commanderThreadId: string;
  name: string;
  projectId: string;
  leads: CrewLead[];
  /** one line: what this crew is doing right now */
  status: string;
}

interface ThreadRow {
  id: string;
  title?: string | null;
  titleFallback?: string | null;
  projectId?: string;
  parentThreadId?: string | null;
}

interface FleetRow {
  threadId: string;
  handle: string | null;
  rank: string;
}

interface BoardRow {
  threadId: string;
  report: { state: string; note: string } | null;
}

/** Strip substrate prefixes: the ranks are Commander, Lead and Sortie. */
function agentName(raw: string): string {
  return raw.replace(/^(sp|plt|cm)[\s·-]+/i, "").replace(/^(sp|plt|cm)[-_]/i, "");
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function crewRpc<T>(method: string): Promise<T | null> {
  const d = await readJson<{ ok?: boolean; result?: T }>(
    `/api/v1/plugins/crew/rpc/${method}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "null" },
  );
  return d?.result ?? null;
}

/**
 * The crews on this rig, assembled for a crew-centric sidebar.
 *
 * A CREW is a commander thread plus the leads reporting to it. The thread list
 * gives the shape (who is whose parent); the crew plugin gives the ranks and
 * each lead's own last report, so a row can say what its lead is doing rather
 * than just naming it. Live off the crew signal and thread changes.
 */
export function useCrews(): { crews: Crew[]; loaded: boolean } {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const raw = await readJson<unknown>("/api/v1/threads?archived=false");
      if (raw == null) return;
      const threads = (
        Array.isArray(raw)
          ? raw
          : ((raw as { threads?: unknown[] }).threads ??
            (raw as { data?: unknown[] }).data ??
            [])
      ) as ThreadRow[];

      const fleet = await crewRpc<{ rows: FleetRow[] }>("crew_fleet");
      const board = await crewRpc<{ rows: BoardRow[] }>("crew_board");
      if (cancelled) return;

      const live = new Set(threads.map((t) => t.id));
      const rankOf = new Map<string, string>();
      const handleOf = new Map<string, string>();
      for (const r of fleet?.rows ?? []) {
        rankOf.set(r.threadId, r.rank);
        if (r.handle) handleOf.set(r.threadId, r.handle);
      }
      const reportOf = new Map<string, { state: string; note: string } | null>();
      for (const b of board?.rows ?? []) reportOf.set(b.threadId, b.report);

      // A commander is a live root thread; its leads are live children.
      const byParent = new Map<string, ThreadRow[]>();
      for (const t of threads) {
        if (!t.parentThreadId) continue;
        const list = byParent.get(t.parentThreadId) ?? [];
        list.push(t);
        byParent.set(t.parentThreadId, list);
      }

      const titleOf = (t: ThreadRow) =>
        agentName((t.title ?? t.titleFallback ?? t.id).trim());

      const next: Crew[] = threads
        .filter((t) => !t.parentThreadId && live.has(t.id))
        .map((commander) => {
          const leads: CrewLead[] = (byParent.get(commander.id) ?? [])
            .filter((t) => live.has(t.id))
            .map((t) => {
              const report = reportOf.get(t.id) ?? null;
              return {
                threadId: t.id,
                name: agentName(handleOf.get(t.id) ?? titleOf(t)),
                status: report?.note ?? null,
                working: report?.state === "working",
              };
            });
          const working = leads.filter((l) => l.working).length;
          return {
            commanderThreadId: commander.id,
            name: titleOf(commander),
            projectId: commander.projectId ?? "",
            leads,
            status:
              leads.length === 0
                ? "no leads yet"
                : working > 0
                  ? `${working} of ${leads.length} working`
                  : `${leads.length} lead${leads.length === 1 ? "" : "s"} standing by`,
          };
        });

      setCrews(next);
      setLoaded(true);
    };

    void load();
    const offSignal = wsManager.onPluginSignal((s) => {
      if (s.pluginId === "crew") void load();
    });
    const offChanged = wsManager.onChanged((m) => {
      if (m.entity === "thread") void load();
    });
    return () => {
      cancelled = true;
      offSignal();
      offChanged();
    };
  }, []);

  return { crews, loaded };
}
