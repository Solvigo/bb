// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createStore, Provider as JotaiProvider } from "jotai";
import { createThreadInfoFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";
import { towerNavAtom } from "./tower/towerNav";
import { useAgentSurfaceTabs } from "./useAgentSurfaceTabs";

vi.mock("./useAgentSurfaceTabs", () => ({
  useAgentSurfaceTabs: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const noop = () => {};

function renderPanel(towerNavValue: any) {
  const { queryClient } = createQueryClientTestHarness();
  const store = createStore();
  store.set(towerNavAtom, towerNavValue);
  return render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TooltipProvider>
            <PanelGroup direction="horizontal">
              <ThreadSecondaryPanel
                activeTab={createThreadInfoFixedPanelTab()}
                canUseGitUi={false}
                isOpen
                metadataContent={null}
                onClose={noop}
                onCollapse={noop}
                onFileTabReorder={noop}
                onOpenNewTab={noop}
                onPanelChange={noop}
                onPanelFocus={noop}
                renderAsDrawer={false}
                isConversationCollapsed={false}
                onToggleConversationCollapse={noop}
              />
            </PanelGroup>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

describe("ThreadSecondaryPanel towerNav", () => {
  it("opens the surface on a tower nav event instead of only showing it", () => {
    const openMock = vi.fn();
    vi.mocked(useAgentSurfaceTabs).mockReturnValue({
      openTabIds: [],
      activeTabId: null,
      open: openMock,
      close: vi.fn(),
      show: vi.fn(),
    });

    renderPanel({ view: "crew", nonce: 1 });

    expect(openMock).toHaveBeenCalledWith("crew");
  });
});
