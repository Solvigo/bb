import { useEffect, useState } from "react";
import { wsManager } from "@/lib/ws";

/**
 * How long a background read waits before giving up. Neither of these surfaces
 * makes a false claim on a hang — they hold their last value — but an unbounded
 * fetch per card leaks a request that never resolves, and a board draws many.
 */
const READ_TIMEOUT_MS = 10_000;

export interface LiveThread {
  projectId: string;
  providerId: string;
  /** The agent's own name, for surfaces that would otherwise print its id. */
  title: string;
  /** Null for an agent with no working tree — a personal or unmanaged
   *  workspace has nothing on disk to read from. */
  environmentId: string | null;
}

/**
 * Live (non-archived) threads by id → their project and provider. The crew RPCs
 * still list archived threads, so every Tower surface filters against this to
 * drop retired crew; a lane's chat also needs its thread's real project and
 * provider rather than a placeholder.
 */
export function useLiveThreads(): Map<string, LiveThread> | null {
  const [threads, setThreads] = useState<Map<string, LiveThread> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), READ_TIMEOUT_MS);
      try {
        const res = await fetch("/api/v1/threads?archived=false", { signal: abort.signal });
        const d: unknown = await res.json();
        const list = Array.isArray(d)
          ? d
          : ((d as { threads?: unknown[]; data?: unknown[] }).threads ??
            (d as { data?: unknown[] }).data ??
            []);
        if (cancelled) return;
        const next = new Map<string, LiveThread>();
        for (const t of list as {
          id?: string;
          projectId?: string;
          providerId?: string;
          title?: string | null;
          titleFallback?: string | null;
          environmentId?: string | null;
        }[]) {
          if (typeof t.id === "string")
            next.set(t.id, {
              projectId: t.projectId ?? "",
              providerId: t.providerId ?? "",
              title: (t.title ?? t.titleFallback ?? "").trim(),
              environmentId: t.environmentId ?? null,
            });
        }
        setThreads(next);
      } catch {
        /* keep the last set; a failed refresh must not blank a surface */
      } finally {
        clearTimeout(timer);
      }
    };
    void load();
    const off = wsManager.onPluginSignal((s) => {
      if (s.pluginId === "crew") void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return threads;
}
