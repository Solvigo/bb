// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyFixedPanelTabsState,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import { useAgentSurfaceTabs } from "./useAgentSurfaceTabs";

const apiMocks = vi.hoisted(() => ({
  getThreadTabs: vi.fn(),
  updateThreadTabs: vi.fn(),
}));

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      threads: {
        tabs: {
          get: apiMocks.getThreadTabs,
          update: apiMocks.updateThreadTabs,
        },
      },
    },
  };
});

function createQueryWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

// The hook's own storage key, independent of the fixedPanelTabsState atom's
// key — see useAgentSurfaceTabs.ts's storageKey().
function agentSurfaceStorageKey(threadId: string): string {
  return `bb.thread.agentSurfaceTabs-${threadId}-1`;
}

beforeEach(() => {
  apiMocks.getThreadTabs.mockResolvedValue({ revision: 0, tabs: [] });
});

afterEach(() => {
  cleanup();
  apiMocks.getThreadTabs.mockReset();
  apiMocks.updateThreadTabs.mockReset();
  window.localStorage.clear();
});

describe("useAgentSurfaceTabs persistence", () => {
  it("starts with nothing open when nothing was ever stored", () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useAgentSurfaceTabs("thr_fresh", "thr_fresh"),
      { wrapper: createQueryWrapper(queryClient) },
    );

    expect(result.current.openTabIds).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
  });

  it("opening a surface updates state and persists it under the thread's own key", () => {
    const threadId = "thr_open";
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useAgentSurfaceTabs(threadId, threadId),
      { wrapper: createQueryWrapper(queryClient) },
    );

    act(() => {
      result.current.open("brief");
    });

    expect(result.current.openTabIds).toEqual(["brief"]);
    expect(result.current.activeTabId).toBe("brief");
    expect(
      JSON.parse(window.localStorage.getItem(agentSurfaceStorageKey(threadId))!),
    ).toEqual({ openTabIds: ["brief"], activeTabId: "brief" });
  });

  it("closing the active surface falls back to whatever else is still open", () => {
    const threadId = "thr_close";
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useAgentSurfaceTabs(threadId, threadId),
      { wrapper: createQueryWrapper(queryClient) },
    );

    act(() => {
      result.current.open("brief");
    });
    act(() => {
      result.current.open("files");
    });
    act(() => {
      result.current.close("files");
    });

    expect(result.current.openTabIds).toEqual(["brief"]);
    expect(result.current.activeTabId).toBe("brief");
    expect(
      JSON.parse(window.localStorage.getItem(agentSurfaceStorageKey(threadId))!),
    ).toEqual({ openTabIds: ["brief"], activeTabId: "brief" });
  });

  it("hydrates a persisted non-empty open set on a fresh mount", async () => {
    const threadId = "thr_hydrate";
    window.localStorage.setItem(
      agentSurfaceStorageKey(threadId),
      JSON.stringify({ openTabIds: ["brief", "files"], activeTabId: "files" }),
    );
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useAgentSurfaceTabs(threadId, threadId),
      { wrapper: createQueryWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.openTabIds).toEqual(["brief", "files"]);
    });
    expect(result.current.activeTabId).toBe("files");
  });

  it("hydrates an explicitly-persisted EMPTY open set, overriding a non-empty in-memory default", async () => {
    // The operator closed every surface, then reloaded. The panel-state atom
    // (a different storage key entirely) already holds a non-empty surface
    // set here on purpose — reproducing whatever the in-memory default would
    // otherwise be — so this only passes if hydration actually APPLIES the
    // stored empty array instead of bailing out because it is empty and
    // leaving the non-empty default standing.
    const threadId = "thr_hydrate_empty";
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({
        state: createEmptyFixedPanelTabsState({
          // Must be recent — the state schema prunes anything older than the
          // idle-expiry window, which would mask the behavior under test.
          lastUsedAt: Date.now(),
          secondary: {
            activeSurfaceTabId: "brief",
            activeTabId: null,
            isOpen: true,
            surfaceTabIds: ["brief"],
            tabs: [],
          },
        }),
      }),
    );
    window.localStorage.setItem(
      agentSurfaceStorageKey(threadId),
      JSON.stringify({ openTabIds: [], activeTabId: null }),
    );
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useAgentSurfaceTabs(threadId, threadId),
      { wrapper: createQueryWrapper(queryClient) },
    );

    // Without the fix, hydration bails out on seeing an empty stored array
    // (treating it as "nothing was ever stored") and this non-empty
    // panel-state default is left standing forever.
    await waitFor(() => {
      expect(result.current.openTabIds).toEqual([]);
    });
    expect(result.current.activeTabId).toBeNull();
  });

  it("keeps two threads' open sets independent", () => {
    const queryClient = createTestQueryClient();
    const { result: a } = renderHook(
      () => useAgentSurfaceTabs("thr_a", "thr_a"),
      { wrapper: createQueryWrapper(queryClient) },
    );
    const { result: b } = renderHook(
      () => useAgentSurfaceTabs("thr_b", "thr_b"),
      { wrapper: createQueryWrapper(queryClient) },
    );

    act(() => {
      a.current.open("brief");
    });

    expect(a.current.openTabIds).toEqual(["brief"]);
    expect(b.current.openTabIds).toEqual([]);
    expect(
      window.localStorage.getItem(agentSurfaceStorageKey("thr_b")),
    ).toBeNull();
  });
});
