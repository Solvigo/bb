import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
  type FixedPanelTabsPanelStateId,
  type FixedPanelTabsSyncThreadId,
} from "@/lib/fixed-panel-tabs";
import {
  getFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  type FixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";

export interface AgentSurfaceTabsState {
  /** Ids of the surfaces this thread has open, in strip order. */
  openTabIds: readonly string[];
  /** Which open surface is showing, or null when none is. */
  activeTabId: string | null;
  /** Opens a surface (or focuses it when already open) and shows it. */
  open: (tabId: string) => void;
  close: (tabId: string) => void;
  show: (tabId: string | null) => void;
}

/**
 * Which agent surfaces a thread has OPEN, remembered per thread.
 *
 * Surfaces used to mount themselves: every thread opened carrying Crew, Brief,
 * Files and Browser whether or not anyone had asked for them, and the first one
 * showed by default. So the panel said the same thing on every agent, and
 * closing a surface lasted until the next navigation.
 *
 * The open set rides the thread's existing panel state — the same record that
 * already remembers its file and terminal tabs — so it persists across
 * navigation and reload for free, and a thread cannot end up with two answers
 * to "which tabs are open".
 */
const STORAGE_PREFIX = "bb.thread.agentSurfaceTabs";
const STORAGE_VERSION = 1;

interface StoredSurfaceTabs {
  openTabIds: string[];
  activeTabId: string | null;
}

function storageKey(threadId: string): string {
  return `${STORAGE_PREFIX}-${threadId}-${STORAGE_VERSION}`;
}

function threadIdFromStorageKey(key: string): string | null {
  const prefix = `${STORAGE_PREFIX}-`;
  const suffix = `-${STORAGE_VERSION}`;
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null;
  return key.slice(prefix.length, key.length - suffix.length);
}

/**
 * Whether the thread's OWNING fixed-panel-tabs record is a live, current
 * record right now — not merely physically present. A raw string can still
 * sit in storage for a record that is schema-invalid or 14+ days idle
 * (FIXED_PANEL_TABS_IDLE_EXPIRY_MS); `parseFixedPanelTabsState` is the one
 * canonical place that already knows how to tell, since it is the exact
 * function the owning atom itself parses through on every read. Reusing it
 * here — rather than re-deriving "is this fresh enough" from a second,
 * independent timestamp check — means there is exactly one answer to that
 * question, and this one can never disagree with the atom's own.
 *
 * A unique sentinel (rather than some real "empty" state) as `initialValue`
 * makes a rejected parse (never stored, corrupt JSON, failed schema, or
 * expired) detectable by reference: `parseFixedPanelTabsState` only ever
 * returns something else when it produced a genuinely fresh, valid record
 * from `storedValue`.
 */
function isOwningFixedPanelTabsRecordCurrent(threadId: string): boolean {
  const raw = window.localStorage.getItem(
    getFixedPanelTabsStateStorageKey({ threadId }),
  );
  if (raw === null) return false;
  const rejectionSentinel = {} as FixedPanelTabsState;
  const parsed = parseFixedPanelTabsState({
    initialValue: rejectionSentinel,
    now: Date.now(),
    storedValue: raw,
  });
  return parsed !== rejectionSentinel;
}

function readStored(threadId: string): StoredSurfaceTabs | null {
  try {
    const raw = window.localStorage.getItem(storageKey(threadId));
    if (raw === null) return null;
    // This key rides beside the thread's fixed-panel-tabs record (every
    // open/close/show write goes through the SAME update() that touches
    // that record too — see the writes below), so the record is the one
    // canonical answer for whether this thread's panel state is still live.
    // Checking only that the owning key is PHYSICALLY PRESENT is not enough:
    // an expired record can sit in storage, unpruned, until some later sweep
    // gets around to deleting it — and hydration runs synchronously on
    // mount, with no guarantee any prune sweep ran first. Parsing the owning
    // record's actual freshness here, synchronously and unconditionally,
    // means this can never resurrect a stale open set into memory no matter
    // what order effects fire in.
    if (!isOwningFixedPanelTabsRecordCurrent(threadId)) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { openTabIds, activeTabId } = parsed as Partial<StoredSurfaceTabs>;
    if (!Array.isArray(openTabIds)) return null;
    return {
      openTabIds: openTabIds.filter(
        (id): id is string => typeof id === "string",
      ),
      activeTabId: typeof activeTabId === "string" ? activeTabId : null,
    };
  } catch {
    return null;
  }
}

function writeStored(threadId: string, value: StoredSurfaceTabs): void {
  try {
    window.localStorage.setItem(storageKey(threadId), JSON.stringify(value));
  } catch {
    // A browser that refuses storage costs the operator the memory of which
    // surfaces were open, and nothing else. Never worth failing the panel for.
  }
}

export function useAgentSurfaceTabs(
  panelStateId: FixedPanelTabsPanelStateId,
  syncThreadId: FixedPanelTabsSyncThreadId,
): AgentSurfaceTabsState {
  const state = useFixedPanelTabsState(panelStateId, syncThreadId);
  const update = useUpdateFixedPanelTabsState(panelStateId, syncThreadId);
  const threadId = typeof panelStateId === "string" ? panelStateId : null;

  const openTabIds = useMemo(
    () => state.secondary.surfaceTabIds,
    [state.secondary.surfaceTabIds],
  );
  const activeTabId = state.secondary.activeSurfaceTabId ?? null;

  const open = useCallback(
    (tabId: string) => {
      update((current) => {
        const ids = current.secondary.surfaceTabIds;
        const next = ids.includes(tabId) ? ids : [...ids, tabId];
        if (threadId !== null) {
          writeStored(threadId, { openTabIds: [...next], activeTabId: tabId });
        }
        return {
          ...current,
          secondary: {
            ...current.secondary,
            surfaceTabIds: next,
            activeSurfaceTabId: tabId,
          },
        };
      });
    },
    [threadId, update],
  );

  const close = useCallback(
    (tabId: string) => {
      update((current) => {
        const ids = current.secondary.surfaceTabIds.filter(
          (id) => id !== tabId,
        );
        // Closing the surface you were looking at falls back to whatever is
        // still open rather than to nothing, so the panel does not blank.
        const nextActive =
          current.secondary.activeSurfaceTabId === tabId
            ? (ids[ids.length - 1] ?? null)
            : (current.secondary.activeSurfaceTabId ?? null);
        if (threadId !== null) {
          writeStored(threadId, {
            openTabIds: [...ids],
            activeTabId: nextActive,
          });
        }
        return {
          ...current,
          secondary: {
            ...current.secondary,
            surfaceTabIds: ids,
            activeSurfaceTabId: nextActive,
          },
        };
      });
    },
    [threadId, update],
  );

  const show = useCallback(
    (tabId: string | null) => {
      update((current) => {
        if (threadId !== null) {
          writeStored(threadId, {
            openTabIds: [...current.secondary.surfaceTabIds],
            activeTabId: tabId,
          });
        }
        return {
          ...current,
          secondary: { ...current.secondary, activeSurfaceTabId: tabId },
        };
      });
    },
    [threadId, update],
  );

  // Durable across reload. The thread's panel record is session state that the
  // server sync rebuilds from its tab LIST, so a field outside that list never
  // survives a refresh; the open set is kept beside it, per thread, instead.
  // `stored === null` means nothing was ever written for this thread (the
  // in-memory default stands); a stored EMPTY array means the operator closed
  // everything, and that has to apply too — treating it like "nothing stored"
  // would resurrect whatever the default happened to be on every reload.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (threadId === null || hydratedFor.current === threadId) return;
    hydratedFor.current = threadId;
    const stored = readStored(threadId);
    if (stored === null) return;
    update((current) => ({
      ...current,
      secondary: {
        ...current.secondary,
        surfaceTabIds: stored.openTabIds,
        activeSurfaceTabId: stored.activeTabId,
      },
    }));
  }, [threadId, update]);

  return { openTabIds, activeTabId, open, close, show };
}

/**
 * Deletes this hook's own storage entries once their owning fixed-panel-tabs
 * record is no longer CURRENT — pruned for 14+ days idle, schema-invalid, or
 * never existed (see `isOwningFixedPanelTabsRecordCurrent`). `readStored`
 * already refuses to resurrect an orphan into memory on its own, synchronous
 * and unconditional; this is pure disk hygiene on top of that guarantee,
 * so an orphan does not sit in storage forever, unreadable but never removed.
 */
export function pruneOrphanedAgentSurfaceTabsStorage(): void {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }

  const orphanedKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;
    const threadId = threadIdFromStorageKey(key);
    if (threadId === null) continue;
    if (!isOwningFixedPanelTabsRecordCurrent(threadId)) {
      orphanedKeys.push(key);
    }
  }

  for (const key of orphanedKeys) {
    try {
      storage.removeItem(key);
    } catch {
      // Best-effort cleanup; nothing depends on this succeeding.
    }
  }
}

/**
 * Sweeps orphaned agent-surface-tabs storage entries on the same cadence the
 * owning fixed-panel-tabs record is pruned on — see
 * useFixedPanelTabsStorageMaintenance, which this is meant to be called
 * alongside.
 */
export function useAgentSurfaceTabsStorageMaintenance(
  panelStateId: FixedPanelTabsPanelStateId,
): void {
  useEffect(() => {
    pruneOrphanedAgentSurfaceTabsStorage();
  }, [panelStateId]);
}
