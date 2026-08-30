// @vitest-environment jsdom

import { useEffect } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createGitDiffFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";
import { useAgentSurfaceTabs } from "./useAgentSurfaceTabs";
import {
  registerAgentSurfaceTab,
  type AgentSurfaceTabProps,
} from "./tower/agentSurfaceRegistry";

vi.mock("./useAgentSurfaceTabs", () => ({
  useAgentSurfaceTabs: vi.fn(),
}));

const noop = () => {};

/** Registers a tab whose component counts its own mounts, so a test can tell
 * "stayed mounted, just hidden" apart from "unmounted and remounted". */
function registerTrackerTab(id: string, mountCounts: Record<string, number>) {
  function TrackerTab({ visible }: AgentSurfaceTabProps) {
    useEffect(() => {
      mountCounts[id] = (mountCounts[id] ?? 0) + 1;
    }, []);
    return (
      <div data-testid={`tab-content-${id}`} data-visible={String(visible)} />
    );
  }
  registerAgentSurfaceTab({
    id,
    label: id,
    icon: "FileText",
    title: id,
    component: TrackerTab,
  });
}

function stubOpenSurfaces(openTabIds: string[], activeTabId: string | null) {
  const surfaces = {
    openTabIds,
    activeTabId,
    open: vi.fn(),
    close: vi.fn(),
    show: vi.fn(),
  };
  vi.mocked(useAgentSurfaceTabs).mockReturnValue(surfaces);
  return surfaces;
}

function Harness({
  activeTab,
  isBrowserTabActive = false,
  canUseGitUi = false,
  onPanelChange = noop,
}: {
  activeTab: SecondaryFixedPanelTab;
  isBrowserTabActive?: boolean;
  canUseGitUi?: boolean;
  onPanelChange?: (panel: ThreadSecondaryPanelTab) => void;
}) {
  return (
    <MemoryRouter>
      <TooltipProvider>
        <PanelGroup direction="horizontal">
          <ThreadSecondaryPanel
            activeTab={activeTab}
            threadId="thr_a"
            canUseGitUi={canUseGitUi}
            isBrowserTabActive={isBrowserTabActive}
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
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadSecondaryPanel surface mounting", () => {
  it("mounts every open surface once, toggling visibility instead of remounting", () => {
    const mountCounts: Record<string, number> = {};
    registerTrackerTab("test-tab-a", mountCounts);
    registerTrackerTab("test-tab-b", mountCounts);
    stubOpenSurfaces(["test-tab-a", "test-tab-b"], "test-tab-a");

    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const view = render(
      <Wrapper>
        <Harness activeTab={createThreadInfoFixedPanelTab()} />
      </Wrapper>,
    );

    const a = view.getByTestId("tab-content-test-tab-a");
    const b = view.getByTestId("tab-content-test-tab-b");
    expect(a.getAttribute("data-visible")).toBe("true");
    expect(b.getAttribute("data-visible")).toBe("false");
    expect(a.parentElement?.className).not.toContain("hidden");
    expect(b.parentElement?.className).toContain("hidden");
    expect(mountCounts).toEqual({ "test-tab-a": 1, "test-tab-b": 1 });

    // Switch which one is active.
    stubOpenSurfaces(["test-tab-a", "test-tab-b"], "test-tab-b");
    view.rerender(
      <Wrapper>
        <Harness activeTab={createThreadInfoFixedPanelTab()} />
      </Wrapper>,
    );

    expect(view.getByTestId("tab-content-test-tab-a").getAttribute(
      "data-visible",
    )).toBe("false");
    expect(view.getByTestId("tab-content-test-tab-b").getAttribute(
      "data-visible",
    )).toBe("true");
    // Neither remounted — the switch only flipped visibility.
    expect(mountCounts).toEqual({ "test-tab-a": 1, "test-tab-b": 1 });

    // Now a different fixed view (diff) takes over the panel entirely.
    view.rerender(
      <Wrapper>
        <Harness activeTab={createGitDiffFixedPanelTab()} />
      </Wrapper>,
    );

    expect(view.getByTestId("tab-content-test-tab-a").parentElement?.className).toContain(
      "hidden",
    );
    expect(view.getByTestId("tab-content-test-tab-b").parentElement?.className).toContain(
      "hidden",
    );
    // Still mounted underneath the diff view, not torn down.
    expect(mountCounts).toEqual({ "test-tab-a": 1, "test-tab-b": 1 });
  });

  it("switching to Diff does not clear which of two open surfaces was active", () => {
    const mountCounts: Record<string, number> = {};
    registerTrackerTab("test-tab-diff-1", mountCounts);
    registerTrackerTab("test-tab-diff-2", mountCounts);
    // The SECOND surface is the one showing before Diff is clicked.
    const surfaces = stubOpenSurfaces(
      ["test-tab-diff-1", "test-tab-diff-2"],
      "test-tab-diff-2",
    );

    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const view = render(
      <Wrapper>
        <Harness activeTab={createThreadInfoFixedPanelTab()} canUseGitUi />
      </Wrapper>,
    );

    expect(
      view
        .getByTestId("tab-content-test-tab-diff-2")
        .getAttribute("data-visible"),
    ).toBe("true");

    fireEvent.click(view.getByRole("button", { name: "Show diff panel" }));

    // The fixed panel already hides tower content while a real view (Diff,
    // a file, ...) is active — `towerViewCanShow` gates on the active FIXED
    // panel, not on the persisted active surface id — so the Diff click has
    // no business touching persisted surface state at all. Calling
    // `show(null)` here was what silently forgot which surface (of two or
    // more) was active: the next time Info showed again, or after a reload,
    // it fell back to the first open tab instead of the one actually shown.
    expect(surfaces.show).not.toHaveBeenCalled();
    expect(surfaces.open).not.toHaveBeenCalled();
    expect(surfaces.close).not.toHaveBeenCalled();
  });

  it("keeps an open surface mounted (just hidden) when the operator switches to the Browser tab", () => {
    const mountCounts: Record<string, number> = {};
    registerTrackerTab("test-tab-browser", mountCounts);
    stubOpenSurfaces(["test-tab-browser"], "test-tab-browser");

    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const view = render(
      <Wrapper>
        <Harness activeTab={createThreadInfoFixedPanelTab()} />
      </Wrapper>,
    );

    expect(
      view
        .getByTestId("tab-content-test-tab-browser")
        .getAttribute("data-visible"),
    ).toBe("true");
    expect(mountCounts).toEqual({ "test-tab-browser": 1 });

    // The operator selects the ordinary Browser fixed tab.
    view.rerender(
      <Wrapper>
        <Harness
          activeTab={createThreadInfoFixedPanelTab()}
          isBrowserTabActive
        />
      </Wrapper>,
    );

    expect(
      view
        .getByTestId("tab-content-test-tab-browser")
        .getAttribute("data-visible"),
    ).toBe("false");
    expect(
      view.getByTestId("tab-content-test-tab-browser").parentElement
        ?.className,
    ).toContain("hidden");
    // Still mounted underneath the browser deck, not torn down.
    expect(mountCounts).toEqual({ "test-tab-browser": 1 });

    // Leaving Browser reveals the same surface again, still never remounted.
    view.rerender(
      <Wrapper>
        <Harness activeTab={createThreadInfoFixedPanelTab()} />
      </Wrapper>,
    );

    expect(
      view
        .getByTestId("tab-content-test-tab-browser")
        .getAttribute("data-visible"),
    ).toBe("true");
    expect(mountCounts).toEqual({ "test-tab-browser": 1 });
  });

  it("shows nothing tower-related and no stale content when the open set is empty", () => {
    stubOpenSurfaces([], null);

    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const view = render(
      <Wrapper>
        <Harness activeTab={createThreadInfoFixedPanelTab()} />
      </Wrapper>,
    );

    expect(view.queryByText("No lead views available")).not.toBeNull();
  });

  it("falls back sanely when the persisted active id no longer exists among open tabs", () => {
    const mountCounts: Record<string, number> = {};
    registerTrackerTab("test-tab-c", mountCounts);
    // Stale active id ("removed-tab") from before a built-in was dropped.
    stubOpenSurfaces(["test-tab-c"], "removed-tab");

    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const view = render(
      <Wrapper>
        <Harness activeTab={createThreadInfoFixedPanelTab()} />
      </Wrapper>,
    );

    // Resolves to the one surface that is actually open rather than blanking.
    expect(view.getByTestId("tab-content-test-tab-c").getAttribute(
      "data-visible",
    )).toBe("true");
  });
});
