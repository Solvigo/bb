import { useEffect, useState } from "react";

/**
 * A "now" that re-renders on a timer, for relative stamps that must not sit on
 * a stale minute.
 *
 * It exists so a screen never calls Date.now() in its render body: that reads
 * as impure to the compiler and, worse, produces a label that only updates
 * when something unrelated happens to re-render the component.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
