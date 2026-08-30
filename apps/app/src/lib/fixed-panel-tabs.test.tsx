import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "jotai";
import { useQueryClient, QueryClientProvider, QueryClient } from "@tanstack/react-query";
import {
  useFixedPanelTabsState,
  useOpenFixedSecondaryPanel,
  useSetFixedSecondaryPanelTab,
  useSetFixedRightTerminalActiveTerminal,
  useUpdateFixedPanelTabsState,
  useRemoveFixedRightTerminalTab,
} from "./fixed-panel-tabs";

function createTestWrapper() {
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Provider>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </Provider>
    );
  };
}

describe("fixed-panel-tabs state-boundary writers", () => {
  it("carries surfaceTabIds and activeSurfaceTabId during panel opening and tab switching", () => {
    const wrapper = createTestWrapper();
    const threadId = "test-thread-id";
    const { result } = renderHook(
      () => {
        const state = useFixedPanelTabsState(threadId, threadId);
        const updateState = useUpdateFixedPanelTabsState(threadId, threadId);
        const openPanel = useOpenFixedSecondaryPanel(threadId, threadId);
        const setPanelTab = useSetFixedSecondaryPanelTab(threadId, threadId);
        const setTerminal = useSetFixedRightTerminalActiveTerminal(threadId, threadId);
        const removeTerminal = useRemoveFixedRightTerminalTab(threadId, threadId);
        return { state, updateState, openPanel, setPanelTab, setTerminal, removeTerminal };
      },
      { wrapper },
    );

    // Setup an initial state with open surface tabs
    act(() => {
      result.current.updateState((current) => ({
        ...current,
        secondary: {
          ...current.secondary,
          surfaceTabIds: ["crew", "brief"],
          activeSurfaceTabId: "crew",
        },
      }));
    });

    expect(result.current.state.secondary.surfaceTabIds).toEqual(["crew", "brief"]);
    expect(result.current.state.secondary.activeSurfaceTabId).toEqual("crew");

    // Act 1: Open the panel
    act(() => {
      result.current.openPanel();
    });

    // Verify preservation
    expect(result.current.state.secondary.isOpen).toBe(true);
    expect(result.current.state.secondary.surfaceTabIds).toEqual(["crew", "brief"]);
    expect(result.current.state.secondary.activeSurfaceTabId).toEqual("crew");

    // Act 2: Set secondary panel tab
    act(() => {
      result.current.setPanelTab("git-diff");
    });

    // Verify preservation
    expect(result.current.state.secondary.activeTabId).toEqual("git-diff");
    expect(result.current.state.secondary.surfaceTabIds).toEqual(["crew", "brief"]);
    expect(result.current.state.secondary.activeSurfaceTabId).toEqual("crew");

    // Act 3: Set terminal
    act(() => {
      result.current.setTerminal("test-term");
    });

    // Verify preservation
    expect(result.current.state.secondary.surfaceTabIds).toEqual(["crew", "brief"]);
    expect(result.current.state.secondary.activeSurfaceTabId).toEqual("crew");

    // Act 4: Remove terminal
    act(() => {
      result.current.removeTerminal("test-term");
    });

    // Verify preservation
    expect(result.current.state.secondary.surfaceTabIds).toEqual(["crew", "brief"]);
    expect(result.current.state.secondary.activeSurfaceTabId).toEqual("crew");
  });
});
