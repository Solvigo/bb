import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
  type FixedPanelTabsPanelStateId,
  type FixedPanelTabsSyncThreadId,
} from "@/lib/fixed-panel-tabs";

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

function readStored(threadId: string): StoredSurfaceTabs | null {
  try {
    const raw = window.localStorage.getItem(storageKey(threadId));
    if (raw === null) return null;
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
    () => state.secondary.surfaceTabIds ?? [],
    [state.secondary.surfaceTabIds],
  );
  const activeTabId = state.secondary.activeSurfaceTabId ?? null;

  const open = useCallback(
    (tabId: string) => {
      update((current) => {
        const ids = current.secondary.surfaceTabIds ?? [];
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
        const ids = (current.secondary.surfaceTabIds ?? []).filter(
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
            openTabIds: [...(current.secondary.surfaceTabIds ?? [])],
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
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (threadId === null || hydratedFor.current === threadId) return;
    hydratedFor.current = threadId;
    const stored = readStored(threadId);
    if (stored === null || stored.openTabIds.length === 0) return;
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
