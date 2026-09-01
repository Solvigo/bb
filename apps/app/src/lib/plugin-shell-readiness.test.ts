// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "./plugin-frontend-boot-state";
import {
  PLUGIN_SHELL_READY_TIMEOUT_MS,
  usePluginShellReady,
} from "./plugin-shell-readiness";

beforeEach(() => {
  vi.useFakeTimers();
  resetPluginFrontendBootStateForTest();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetPluginFrontendBootStateForTest();
});

describe("usePluginShellReady", () => {
  it("is false until plugins settle", () => {
    const { result } = renderHook(() => usePluginShellReady());
    expect(result.current).toBe(false);
  });

  it("becomes true as soon as plugins settle", () => {
    const { result } = renderHook(() => usePluginShellReady());
    act(() => {
      markPluginFrontendsSettled();
    });
    expect(result.current).toBe(true);
  });

  it("times out to true when plugins never settle", () => {
    const { result } = renderHook(() => usePluginShellReady());
    act(() => {
      vi.advanceTimersByTime(PLUGIN_SHELL_READY_TIMEOUT_MS - 1);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it("stays true after a late settle following its own timeout", () => {
    const { result } = renderHook(() => usePluginShellReady());
    act(() => {
      vi.advanceTimersByTime(PLUGIN_SHELL_READY_TIMEOUT_MS);
    });
    expect(result.current).toBe(true);
    act(() => {
      markPluginFrontendsSettled();
    });
    expect(result.current).toBe(true);
  });

  it("clears its timer on unmount", () => {
    const { unmount } = renderHook(() => usePluginShellReady());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors a caller-supplied timeout", () => {
    const { result } = renderHook(() => usePluginShellReady(500));
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });
});
