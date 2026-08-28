import { useEffect, useState } from "react";

export interface ItemTransition {
  at: string;
  fromState: string;
  toState: string;
  byActor: string;
  detail: string | null;
}

export interface ItemTrail {
  transitions: ItemTransition[];
  /** the walk was capped; there are older moves than these */
  truncated: boolean;
  /** false only until the first attempt resolves */
  loaded: boolean;
}

/**
 * Every hop one work item took, oldest first.
 *
 * An EMPTY walk is a real answer, not a gap: an item that has not moved since
 * the transition log existed genuinely has no hops, and the store distinguishes
 * that from an id nobody minted (which is a refusal). So the surface must say
 * "no moves recorded" rather than draw nothing and let the operator assume the
 * feature is broken.
 *
 * `truncated` is measured by the store rather than guessed from the row count —
 * a walk of exactly `limit` moves is complete, and a heuristic would report it
 * as cut off. Pass it through; a capped history that reads as the whole one is
 * exactly where a silent substitution would be believed.
 */
export function useItemTrail(taskId: string | null): ItemTrail {
  const [trail, setTrail] = useState<ItemTrail>({
    transitions: [],
    truncated: false,
    loaded: false,
  });
  useEffect(() => {
    if (!taskId) {
      setTrail({ transitions: [], truncated: false, loaded: false });
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8_000);
    void (async () => {
      try {
        const res = await fetch(
          "/api/v1/plugins/crew/rpc/crew_transitions_list",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ taskId }),
            signal: abort.signal,
          },
        );
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as {
          result?: { transitions?: ItemTransition[]; truncated?: boolean };
        };
        if (cancelled) return;
        setTrail({
          transitions: body.result?.transitions ?? [],
          truncated: Boolean(body.result?.truncated),
          loaded: true,
        });
      } catch {
        // Resolve either way: a read that never finishes must not leave the
        // trail permanently "loading", which reads as a hang rather than a
        // failure. Empty-and-loaded is honest; empty-and-never-loaded is not.
        if (!cancelled)
          setTrail({ transitions: [], truncated: false, loaded: true });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [taskId]);
  return trail;
}
