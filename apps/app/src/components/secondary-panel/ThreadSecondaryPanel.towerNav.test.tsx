// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createStore, Provider as JotaiProvider } from "jotai";
import { createThreadInfoFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";
import { towerNavAtom, type TowerNavRequest } from "./tower/towerNav";
import { useAgentSurfaceTabs } from "./useAgentSurfaceTabs";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";

vi.mock("./useAgentSurfaceTabs", () => ({
  useAgentSurfaceTabs: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const noop = () => {};

function stubSurfaces(open = vi.fn()) {
  vi.mocked(useAgentSurfaceTabs).mockReturnValue({
    openTabIds: [],
    activeTabId: null,
    open,
    close: vi.fn(),
    show: vi.fn(),
  });
  return open;
}

function renderPanel({
  threadId,
  store,
  onPanelChange = noop,
}: {
  threadId?: string;
  store: ReturnType<typeof createStore>;
  onPanelChange?: (panel: ThreadSecondaryPanelTab) => void;
}) {
  const { queryClient } = createQueryClientTestHarness();
  return render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TooltipProvider>
            <PanelGroup direction="horizontal">
              <ThreadSecondaryPanel
                activeTab={createThreadInfoFixedPanelTab()}
                threadId={threadId}
                canUseGitUi={false}
                isOpen
                metadataContent={null}
                onClose={noop}
                onCollapse={noop}
                onFileTabReorder={noop}
                onOpenNewTab={noop}
                onPanelChange={onPanelChange}
                onPanelFocus={noop}
                renderAsDrawer={false}
                isConversationCollapsed={false}
                onToggleConversationCollapse={noop}
              />
            </PanelGroup>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
}

function towerNavFor(threadId: string, nonce: number): TowerNavRequest {
  return { threadId, view: "brief", nonce };
}

describe("ThreadSecondaryPanel towerNav", () => {
  it("opens the surface on a tower nav event targeting this thread", () => {
    const open = stubSurfaces();
    const store = createStore();
    store.set(towerNavAtom, towerNavFor("thr_a", 1));

    renderPanel({ threadId: "thr_a", store });

    expect(open).toHaveBeenCalledWith("brief");
  });

  it("ignores a request addressed to a different thread (cross-thread isolation)", () => {
    const open = stubSurfaces();
    const store = createStore();
    store.set(towerNavAtom, towerNavFor("thr_other", 1));

    renderPanel({ threadId: "thr_a", store });

    expect(open).not.toHaveBeenCalled();
  });

  it("a single nav request only ever opens the surface on the thread it targets, not every mounted panel", () => {
    const openA = vi.fn();
    const openB = vi.fn();
    const store = createStore();
    store.set(towerNavAtom, towerNavFor("thr_a", 1));

    vi.mocked(useAgentSurfaceTabs).mockImplementation((panelStateId) => ({
      openTabIds: [],
      activeTabId: null,
      open: panelStateId === "thr_a" ? openA : openB,
      close: vi.fn(),
      show: vi.fn(),
    }));

    // Two panes, each showing a different thread, both subscribed to the same
    // fleet-wide towerNavAtom — this is the split-view shape the bug report
    // describes.
    renderPanel({ threadId: "thr_a", store });
    renderPanel({ threadId: "thr_b", store });

    expect(openA).toHaveBeenCalledWith("brief");
    expect(openB).not.toHaveBeenCalled();
  });

  it("switches the fixed panel back to thread-info so the surface is not hidden behind another active view", () => {
    stubSurfaces();
    const store = createStore();
    store.set(towerNavAtom, towerNavFor("thr_a", 1));
    const onPanelChange = vi.fn();

    renderPanel({ threadId: "thr_a", store, onPanelChange });

    expect(onPanelChange).toHaveBeenCalledWith("thread-info");
  });

  it("does not replay an already-handled nonce when the panel unmounts and remounts", () => {
    const open = stubSurfaces();
    const store = createStore();
    store.set(towerNavAtom, towerNavFor("thr_a", 1));

    const first = renderPanel({ threadId: "thr_a", store });
    expect(open).toHaveBeenCalledTimes(1);
    first.unmount();

    renderPanel({ threadId: "thr_a", store });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("still fires for a genuinely new nonce to the same thread", () => {
    const open = stubSurfaces();
    const store = createStore();
    store.set(towerNavAtom, towerNavFor("thr_a", 1));

    renderPanel({ threadId: "thr_a", store });
    expect(open).toHaveBeenCalledTimes(1);

    act(() => {
      store.set(towerNavAtom, towerNavFor("thr_a", 2));
    });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the panel has no thread (e.g. root compose)", () => {
    const open = stubSurfaces();
    const store = createStore();
    store.set(towerNavAtom, towerNavFor("thr_a", 1));

    renderPanel({ threadId: undefined, store });

    expect(open).not.toHaveBeenCalled();
  });
});
