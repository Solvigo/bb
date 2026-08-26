import { useEffect, useRef, useState } from "react";
import { wsManager } from "@/lib/ws";

/**
 * Reads a Tower plugin's composition RPC — POST /api/v1/plugins/<id>/rpc/<method>
 * — LIVE via the realtime signal channel (no polling). Fetch once on mount, then
 * refetch on every `plugin-signal` frame for this plugin and on every WS
 * (re)connect. Signals are ephemeral with no replay, so the connect refetch is
 * what keeps a surface from going stale after a drop. `ageSeconds` is time since
 * the last fetch — near-zero while live, honest evidence when the socket is down.
 */
/**
 * How long a board read waits before it gives up and SAYS so. Without a bound a
 * hung fetch never settles, `loading` stays true for the life of the session,
 * and the board sits on "loading leads…" forever — a hang reads as a spinner,
 * which is a lie in the same way invented data is. Observed twice on this
 * machine under load.
 */
const RPC_TIMEOUT_MS = 12_000;

export interface CrewRpcState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /**
   * The last attempt ran out of patience rather than being refused. A slow
   * server and a broken one need different words and different remedies;
   * collapsing them sent a live incident hunting a fault that was really a
   * loaded machine.
   */
  timedOut: boolean;
  /** seconds since the last successful (or failed) fetch, for honest display */
  ageSeconds: number;
}

export function useCrewRpc<T>(
  pluginId: string,
  method: string,
  input: unknown = null,
): CrewRpcState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Serialize the input so a changed input (a new group/subject/artifactId)
  // re-runs the fetch effect — refs alone don't retrigger it.
  const inputKey = JSON.stringify(input ?? null);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const abort = new AbortController();
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        abort.abort();
      }, RPC_TIMEOUT_MS);
      try {
        const res = await fetch(
          `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${encodeURIComponent(method)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(inputRef.current),
            signal: abort.signal,
          },
        );
        const json: unknown = await res.json();
        if (cancelled) return;
        const envelope = json as {
          ok?: boolean;
          result?: T;
          error?: { message?: string };
        };
        if (envelope.ok && envelope.result !== undefined) {
          setData(envelope.result);
          setError(null);
          setTimedOut(false);
        } else {
          setError(envelope.error?.message ?? "rpc returned no result");
        }
      } catch (e) {
        if (!cancelled) {
          setTimedOut(expired);
          setError(
            expired
              ? `no answer in ${Math.round(RPC_TIMEOUT_MS / 1000)}s`
              : e instanceof Error
                ? e.message
                : String(e),
          );
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) {
          setLoading(false);
          setFetchedAt(Date.now());
        }
      }
    };
    void run();
    // Live: refetch on every signal for this plugin, and on every (re)connect —
    // signals are ephemeral, so the connect refetch is the anti-stale guarantee.
    const offSignal = wsManager.onPluginSignal((signal) => {
      if (signal.pluginId === pluginId) void run();
    });
    const offConn = wsManager.onConnectionStateChange(() => {
      if (wsManager.getConnectionState() === "connected") void run();
    });
    return () => {
      cancelled = true;
      offSignal();
      offConn();
    };
  }, [pluginId, method, inputKey]);

  // tick a clock so the displayed age advances between polls
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ageSeconds =
    fetchedAt === null ? 0 : Math.max(0, Math.round((now - fetchedAt) / 1000));

  return { data, error, loading, timedOut, ageSeconds };
}

export function ageLabel(seconds: number): string {
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  return `${m}m ago`;
}
