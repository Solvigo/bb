import { useEffect, useState } from "react";
import { wsManager } from "@/lib/ws";

/**
 * How long a background read waits before giving up. Neither of these surfaces
 * makes a false claim on a hang — they hold their last value — but an unbounded
 * fetch per card leaks a request that never resolves, and a board draws many.
 */
const READ_TIMEOUT_MS = 10_000;

export interface SortieActivity {
  /** true while the sortie's own turn is still running */
  working: boolean;
  /** the last thing that actually happened, in the agent's own words */
  line: string;
}

interface TimelineRow {
  kind: string;
  role?: string;
  text?: string | null;
  status?: string;
  createdAt: number;
}

/**
 * The last line of activity on a sortie's thread — what the agent is doing
 * right now, or the last thing it said. Streams off the thread's own change
 * events so a card is never staler than the conversation it reports on.
 *
 * Deliberately reports only what the timeline actually carries: a running turn
 * plus the newest text. It never invents a tool name it cannot see, because a
 * plausible-looking activity line is worse than an honest quiet one.
 */
export function useSortieActivity(
  threadId: string | null,
): SortieActivity | null {
  const [activity, setActivity] = useState<SortieActivity | null>(null);
  useEffect(() => {
    if (!threadId) {
      setActivity(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), READ_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/v1/threads/${threadId}/timeline`, {
          signal: abort.signal,
        });
        const d = (await res.json()) as {
          rows?: TimelineRow[];
          activeThinking?: unknown;
        };
        const rows = d.rows ?? [];
        const lastTurn = [...rows].reverse().find((r) => r.kind === "turn");
        const working =
          Boolean(d.activeThinking) ||
          (lastTurn?.status != null &&
            lastTurn.status !== "completed" &&
            lastTurn.status !== "failed" &&
            lastTurn.status !== "interrupted");
        const lastSaid = [...rows]
          .reverse()
          .find((r) => r.kind === "conversation" && (r.text ?? "").trim());
        if (cancelled) return;
        const text = (lastSaid?.text ?? "").trim().replace(/\s+/g, " ");
        setActivity({
          working,
          line: working
            ? text
              ? `working · ${text}`
              : "working…"
            : text || "no transmissions yet",
        });
      } catch {
        /* keep the last line; a failed refresh must not blank a card */
      } finally {
        clearTimeout(timer);
      }
    };
    void load();
    wsManager.subscribe({ kind: "thread-detail", threadId });
    const offChanged = wsManager.onChanged((m) => {
      if (m.entity === "thread" && (!m.id || m.id === threadId)) void load();
    });
    const offSignal = wsManager.onPluginSignal((s) => {
      if (s.pluginId === "crew") void load();
    });
    return () => {
      cancelled = true;
      offChanged();
      offSignal();
      wsManager.unsubscribe({ kind: "thread-detail", threadId });
    };
  }, [threadId]);
  return activity;
}
