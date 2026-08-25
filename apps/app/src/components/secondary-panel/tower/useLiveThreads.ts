import { useEffect, useState } from "react";
import { wsManager } from "@/lib/ws";

export interface LiveThread {
  projectId: string;
  providerId: string;
  /** The agent's own name, for surfaces that would otherwise print its id. */
  title: string;
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
      try {
        const res = await fetch("/api/v1/threads?archived=false");
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
        }[]) {
          if (typeof t.id === "string")
            next.set(t.id, {
              projectId: t.projectId ?? "",
              providerId: t.providerId ?? "",
              title: (t.title ?? t.titleFallback ?? "").trim(),
            });
        }
        setThreads(next);
      } catch {
        /* keep the last set; a failed refresh must not blank a surface */
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
