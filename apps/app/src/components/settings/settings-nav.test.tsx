// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSettingsNavState } from "./settings-nav";

const mocks = vi.hoisted(() => ({
  plugins: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginList: () => ({ data: { plugins: mocks.plugins } }),
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
}));

function wrapperFor(path: string) {
  const { wrapper: QueryWrapper } = createQueryClientTestHarness();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryWrapper>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryWrapper>
    );
  };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.clearAllMocks();
  mocks.plugins = [];
});

describe("useSettingsNavState", () => {
  it("carries a harness route through as a deep link, not its own page", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/providers/claude-code"),
    });

    expect(result.current.activeProviderId).toBe("claude-code");
    expect(result.current.activeSection).toBe("providers");
  });

  // The harness list is the instance's, not the nav's. It used to be a
  // hardcoded pair, so an instance that knew four showed two and the other two
  // could not be reached at all — including by typing the URL, which the nav
  // treated as a malformed section and redirected away from.
  it("lets a harness the nav has never heard of through to the page", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/providers/acp-cursor"),
    });

    expect(result.current.activeProviderId).toBe("acp-cursor");
    expect(result.current.hasUnknownSection).toBe(false);
  });

  it("shows the Machines section", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/machines"),
    });

    expect(result.current.sections.map((section) => section.id)).toContain(
      "machines",
    );
  });

  it("resolves archived threads as a settings section", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/archived"),
    });

    expect(result.current.activeSection).toBe("archived");
    expect(result.current.sections.map((section) => section.id)).toContain(
      "archived",
    );
  });

  it("hides legacy plugin management but preserves registered plugin settings", () => {
    mocks.plugins = [
      {
        id: "workflows",
        enabled: true,
        hasSettings: true,
      },
    ];
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings"),
    });

    expect(result.current.sections.map((section) => section.id)).not.toContain(
      "plugins",
    );
    expect(result.current.pluginEntries.map((plugin) => plugin.id)).toEqual([
      "workflows",
    ]);
  });
});
