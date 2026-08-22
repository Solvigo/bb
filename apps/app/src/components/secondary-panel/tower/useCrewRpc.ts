import { useEffect, useRef, useState } from "react";

/**
 * Polls a Tower plugin's composition RPC — POST /api/v1/plugins/<id>/rpc/<method>.
 * The no-refresh law is satisfied in wave 2 (the publish channel); until then an
 * HONEST poll age beats a fake liveness, so we expose `ageSeconds` for the UI to
 * show plainly. Fixtures are gone — this reads the live disposable instance.
 */
export interface CrewRpcState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** seconds since the last successful (or failed) fetch, for honest display */
  ageSeconds: number;
}

const POLL_MS = 5000;

export function useCrewRpc<T>(
  pluginId: string,
  method: string,
  input: unknown = null,
): CrewRpcState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(
          `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${encodeURIComponent(method)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(inputRef.current),
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
        } else {
          setError(envelope.error?.message ?? "rpc returned no result");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setFetchedAt(Date.now());
        }
      }
    };
    void run();
    const poll = setInterval(run, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [pluginId, method]);

  // tick a clock so the displayed age advances between polls
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ageSeconds =
    fetchedAt === null ? 0 : Math.max(0, Math.round((now - fetchedAt) / 1000));

  return { data, error, loading, ageSeconds };
}

export function ageLabel(seconds: number): string {
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  return `${m}m ago`;
}
