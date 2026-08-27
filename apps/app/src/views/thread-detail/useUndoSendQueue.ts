import { useCallback, useEffect, useRef, useState } from "react";
import {
  ESCAPE_OWNED_BY_OVERLAY_SELECTOR,
  escapeShouldUndo,
  latestUndoTarget,
  partitionExpired,
  UNDO_SEND_WINDOW_MS,
  withoutEntry,
  type PendingSend,
} from "./undoSendQueue";

const TICK_MS = 100;

export type EnqueuePendingSendArgs = Omit<PendingSend, "id" | "expiresAt">;

export interface UseUndoSendQueueArgs {
  /**
   * Pending sends are flushed when this changes, so a thread switch delivers
   * what is in flight instead of carrying it into the next thread.
   */
  flushKey: string;
  onDispatch: (entry: PendingSend) => void | Promise<void>;
  onUndo: (entry: PendingSend) => void;
  windowMs?: number;
}

export interface UndoSendQueue {
  entries: readonly PendingSend[];
  /** Re-read every tick so consumers can render a live countdown. */
  now: number;
  enqueue: (args: EnqueuePendingSendArgs) => void;
  undo: (id: string) => void;
}

let idCounter = 0;

function nextPendingSendId(): string {
  idCounter += 1;
  return `pending-send-${idCounter}`;
}

/**
 * Holds a just-sent message for a grace period so it can be pulled back into
 * the composer, then delivers it.
 *
 * Dispatch is strictly FIFO: every entry shares one window length, so expiry
 * order is enqueue order, and the deliveries are chained rather than raced so
 * two messages sent a beat apart reach the agent in the order they were typed.
 */
export function useUndoSendQueue({
  flushKey,
  onDispatch,
  onUndo,
  windowMs = UNDO_SEND_WINDOW_MS,
}: UseUndoSendQueueArgs): UndoSendQueue {
  const [entries, setEntries] = useState<readonly PendingSend[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const entriesRef = useRef<readonly PendingSend[]>([]);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const onDispatchRef = useRef(onDispatch);
  const onUndoRef = useRef(onUndo);

  useEffect(() => {
    onDispatchRef.current = onDispatch;
    onUndoRef.current = onUndo;
  });

  const commit = useCallback((next: readonly PendingSend[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const dispatch = useCallback((entry: PendingSend) => {
    chainRef.current = chainRef.current
      .then(() => onDispatchRef.current(entry))
      .catch(() => undefined);
  }, []);

  const enqueue = useCallback(
    (args: EnqueuePendingSendArgs) => {
      const startedAt = Date.now();
      setNow(startedAt);
      commit([
        ...entriesRef.current,
        { ...args, id: nextPendingSendId(), expiresAt: startedAt + windowMs },
      ]);
    },
    [commit, windowMs],
  );

  const undo = useCallback(
    (id: string) => {
      const entry = entriesRef.current.find((candidate) => candidate.id === id);
      if (!entry) {
        return;
      }
      commit(withoutEntry(entriesRef.current, id));
      onUndoRef.current(entry);
    },
    [commit],
  );

  const flushAll = useCallback(() => {
    const pending = entriesRef.current;
    if (pending.length === 0) {
      return;
    }
    commit([]);
    for (const entry of pending) {
      dispatch(entry);
    }
  }, [commit, dispatch]);

  const flushAllRef = useRef(flushAll);
  useEffect(() => {
    flushAllRef.current = flushAll;
  });

  const hasEntries = entries.length > 0;

  useEffect(() => {
    if (!hasEntries) {
      return;
    }
    const interval = setInterval(() => {
      const tickedAt = Date.now();
      setNow(tickedAt);
      const { expired, waiting } = partitionExpired(
        entriesRef.current,
        tickedAt,
      );
      if (expired.length === 0) {
        return;
      }
      commit(waiting);
      for (const entry of expired) {
        dispatch(entry);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [commit, dispatch, hasEntries]);

  useEffect(() => {
    if (!hasEntries) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }
      const target = latestUndoTarget(entriesRef.current);
      if (
        !target ||
        !escapeShouldUndo({
          hasPending: true,
          defaultPrevented: event.defaultPrevented,
          isOverlayOpen:
            document.querySelector(ESCAPE_OWNED_BY_OVERLAY_SELECTOR) !== null,
        })
      ) {
        return;
      }
      event.preventDefault();
      // Stops the composer's own Escape-to-blur from also running: the editor
      // still holds focus after a send, and undo puts the draft back into it.
      event.stopPropagation();
      undo(target.id);
    }
    // Capture, so undo is decided before the event reaches the editor.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [hasEntries, undo]);

  useEffect(() => () => flushAllRef.current(), [flushKey]);

  useEffect(() => {
    function flushOnLeave(): void {
      flushAllRef.current();
    }
    function flushWhenHidden(): void {
      if (document.visibilityState === "hidden") {
        flushAllRef.current();
      }
    }
    window.addEventListener("pagehide", flushOnLeave);
    window.addEventListener("beforeunload", flushOnLeave);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushOnLeave);
      window.removeEventListener("beforeunload", flushOnLeave);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, []);

  return { entries, now, enqueue, undo };
}
