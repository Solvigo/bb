// @vitest-environment jsdom

import { useEffect } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TowerRenderSurface } from "./TowerRenderSurface";
import { useAgentSurfaceTabs } from "../useAgentSurfaceTabs";
import {
  registerAgentSurfaceTab,
  type AgentSurfaceTabProps,
} from "./agentSurfaceRegistry";

vi.mock("../useAgentSurfaceTabs", () => ({
  useAgentSurfaceTabs: vi.fn(),
}));

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

function stubSurfaces(openTabIds: string[], activeTabId: string | null) {
  const open = vi.fn();
  const close = vi.fn();
  vi.mocked(useAgentSurfaceTabs).mockReturnValue({
    openTabIds,
    activeTabId,
    open,
    close,
    show: vi.fn(),
  });
  return { open, close };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TowerRenderSurface", () => {
  it("does not auto-open the first registered tab when nothing is persisted as open", () => {
    stubSurfaces([], null);

    const view = render(<TowerRenderSurface scopeThreadId="thr_lead" />);

    expect(view.queryByText("Nothing open")).not.toBeNull();
  });

  it("opens a registered tab through the same per-agent persisted set the top-level surface uses", () => {
    const mountCounts: Record<string, number> = {};
    registerTrackerTab("nested-tab-a", mountCounts);
    const { open } = stubSurfaces([], null);

    const view = render(<TowerRenderSurface scopeThreadId="thr_lead" />);
    fireEvent.click(view.getByRole("button", { name: "Show nested-tab-a" }));

    expect(open).toHaveBeenCalledWith("nested-tab-a");
  });

  it("renders and keeps mounted every tab in the persisted open set, only the active one visible", () => {
    const mountCounts: Record<string, number> = {};
    registerTrackerTab("nested-tab-b", mountCounts);
    registerTrackerTab("nested-tab-c", mountCounts);
    stubSurfaces(["nested-tab-b", "nested-tab-c"], "nested-tab-b");

    const view = render(<TowerRenderSurface scopeThreadId="thr_lead" />);

    expect(
      view.getByTestId("tab-content-nested-tab-b").getAttribute("data-visible"),
    ).toBe("true");
    expect(
      view.getByTestId("tab-content-nested-tab-c").getAttribute("data-visible"),
    ).toBe("false");
    expect(mountCounts).toEqual({ "nested-tab-b": 1, "nested-tab-c": 1 });

    stubSurfaces(["nested-tab-b", "nested-tab-c"], "nested-tab-c");
    view.rerender(<TowerRenderSurface scopeThreadId="thr_lead" />);

    expect(
      view.getByTestId("tab-content-nested-tab-b").getAttribute("data-visible"),
    ).toBe("false");
    expect(
      view.getByTestId("tab-content-nested-tab-c").getAttribute("data-visible"),
    ).toBe("true");
    // Switching which tab is active never remounted either one.
    expect(mountCounts).toEqual({ "nested-tab-b": 1, "nested-tab-c": 1 });
  });

  it("offers a close action only for a tab that is actually open, and closing calls through to the persisted set", () => {
    registerAgentSurfaceTab({
      id: "nested-tab-d",
      label: "nested-tab-d",
      icon: "FileText",
      title: "nested-tab-d",
      component: () => <div />,
    });
    const { close } = stubSurfaces(["nested-tab-d"], "nested-tab-d");

    const view = render(<TowerRenderSurface scopeThreadId="thr_lead" />);

    const closeButton = view.getByRole("button", {
      name: "Close nested-tab-d",
    });
    fireEvent.click(closeButton);
    expect(close).toHaveBeenCalledWith("nested-tab-d");
  });

  it("falls back to the surface that is actually open when the persisted active id is stale", () => {
    registerAgentSurfaceTab({
      id: "nested-tab-e",
      label: "nested-tab-e",
      icon: "FileText",
      title: "nested-tab-e",
      component: () => <div data-testid="tab-content-nested-tab-e" />,
    });
    stubSurfaces(["nested-tab-e"], "a-removed-tab-id");

    const view = render(<TowerRenderSurface scopeThreadId="thr_lead" />);

    expect(view.getByTestId("tab-content-nested-tab-e")).not.toBeNull();
    expect(view.queryByText("Nothing open")).toBeNull();
  });
});
