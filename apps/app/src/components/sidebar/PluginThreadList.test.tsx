// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import { resetDeprecatedAliasWarningsForTests } from "@/lib/plugin-sdk-deprecated-aliases";
import { PLUGIN_SHELL_READY_TIMEOUT_MS } from "@/lib/plugin-shell-readiness";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { PluginThreadList } from "./PluginThreadList";

function pluginReplacement(
  component: (props: PluginThreadListProps) => React.ReactNode,
): ResolvedReplacement<PluginThreadListSlot> {
  return {
    kind: "plugin",
    registration: {
      pluginId: "demo",
      generation: 1,
      id: "list",
      title: "Demo list",
      component,
    },
  };
}

function renderList(
  replacement: ResolvedReplacement<PluginThreadListSlot>,
  searchQuery = "",
) {
  const ui = (query: string) => (
    <MemoryRouter>
      <SidebarProvider>
        <PluginThreadList
          replacement={replacement}
          original={<div data-testid="bb-thread-list">bb thread list</div>}
          searchQuery={query}
          onNavigate={() => {}}
        />
      </SidebarProvider>
    </MemoryRouter>
  );
  const result = render(ui(searchQuery));
  return {
    ...result,
    rerenderWith: (query: string) => result.rerender(ui(query)),
  };
}

beforeEach(() => {
  resetDeprecatedAliasWarningsForTests();
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
});

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginFrontendBootStateForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PluginThreadList experimental_Original alias", () => {
  it("delegates to BB's list through the alias and warns once across renders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const { rerenderWith } = renderList(
      pluginReplacement(
        ({ experimental_Original: LegacyOriginal, searchQuery }) => {
          seen.push(searchQuery);
          return LegacyOriginal === undefined ? (
            <div>alias missing</div>
          ) : (
            <LegacyOriginal />
          );
        },
      ),
    );

    expect(screen.getByTestId("bb-thread-list")).toBeDefined();
    rerenderWith("needle");
    expect(screen.getByTestId("bb-thread-list")).toBeDefined();
    expect(seen).toEqual(["", "needle"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "experimental_Original is deprecated; use Original. Removed in bb 0.42",
    );
  });

  it("never warns for a list that reads Original", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderList(pluginReplacement(({ Original }) => <Original />));

    expect(screen.getByTestId("bb-thread-list")).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("PluginThreadList cold-load readiness gate", () => {
  it("renders nothing before plugins settle", () => {
    resetPluginFrontendBootStateForTest();
    renderList(pluginReplacement(() => <div data-testid="plugin-list" />));

    expect(screen.queryByTestId("bb-thread-list")).toBeNull();
    expect(screen.queryByTestId("plugin-list")).toBeNull();
  });

  it("renders the registered replacement once settled, without ever showing native first", () => {
    resetPluginFrontendBootStateForTest();
    renderList(pluginReplacement(() => <div data-testid="plugin-list" />));

    expect(screen.queryByTestId("bb-thread-list")).toBeNull();
    expect(screen.queryByTestId("plugin-list")).toBeNull();

    act(() => {
      markPluginFrontendsSettled();
    });

    expect(screen.getByTestId("plugin-list")).toBeDefined();
    expect(screen.queryByTestId("bb-thread-list")).toBeNull();
  });

  it("renders native once settled when no plugin has registered a replacement", () => {
    resetPluginFrontendBootStateForTest();
    renderList({ kind: "owner" });

    expect(screen.queryByTestId("bb-thread-list")).toBeNull();

    act(() => {
      markPluginFrontendsSettled();
    });

    expect(screen.getByTestId("bb-thread-list")).toBeDefined();
  });

  it("falls back to native after the readiness timeout elapses without settling", () => {
    vi.useFakeTimers();
    resetPluginFrontendBootStateForTest();
    renderList({ kind: "owner" });

    expect(screen.queryByTestId("bb-thread-list")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(PLUGIN_SHELL_READY_TIMEOUT_MS);
    });

    expect(screen.getByTestId("bb-thread-list")).toBeDefined();
  });

  it("recovers to native, not a permanent blank, when a settled replacement crashes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetPluginFrontendBootStateForTest();
    function Crash(): never {
      throw new Error("replacement failed");
    }
    renderList(pluginReplacement(() => <Crash />));

    expect(screen.queryByTestId("bb-thread-list")).toBeNull();

    act(() => {
      markPluginFrontendsSettled();
    });

    expect(screen.getByTestId("bb-thread-list")).toBeDefined();
  });
});
