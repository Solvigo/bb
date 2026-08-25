// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ws", () => ({
  wsManager: {
    onPluginSignal: () => () => {},
    onChanged: () => () => {},
  },
}));

const THREADS = [
  { id: "thr_cmd", title: "Commander · Airways", projectId: "p", parentThreadId: null },
  { id: "thr_lead", title: "Lead · shell", projectId: "p", parentThreadId: "thr_cmd" },
];

describe("useCrews", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/threads")
          ? { ok: true, json: async () => THREADS }
          : { ok: true, json: async () => ({ result: { rows: [] } }) },
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives every surface the same answer, so two of them cannot disagree", async () => {
    // The defect this guards: the home screen said "No crews yet" beside a rail
    // listing a crew, at the same instant, because each owned a separate read.
    const { useCrews } = await import("./useCrews");
    const rail = renderHook(() => useCrews());
    const home = renderHook(() => useCrews());

    await waitFor(() => expect(rail.result.current.loaded).toBe(true));

    expect(home.result.current.loaded).toBe(rail.result.current.loaded);
    expect(home.result.current.crews).toEqual(rail.result.current.crews);
    expect(rail.result.current.crews).toHaveLength(1);
    expect(rail.result.current.crews[0]?.leads).toHaveLength(1);
  });

  it("reads the fleet once no matter how many surfaces ask", async () => {
    const { useCrews } = await import("./useCrews");
    renderHook(() => useCrews());
    renderHook(() => useCrews());
    renderHook(() => useCrews());

    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.filter(([u]) => String(u).includes("/threads"))).toHaveLength(1);
    });
  });

  it("says the fleet is slow, not broken, when it simply has not answered", async () => {
    // These need different words and different remedies. Collapsing them once
    // sent a live incident looking for a fault that was really just a loaded
    // machine — the box running this app also runs the fleet's CI.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
      ),
    );
    vi.useFakeTimers();
    const { useCrews } = await import("./useCrews");
    const { result } = renderHook(() => useCrews());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    vi.useRealTimers();
    expect(result.current.loaded).toBe(true);
    expect(result.current.failed).toBe(true);
    expect(result.current.timedOut).toBe(true);
  });

  it("never reports an empty fleet before it has read one", async () => {
    const { useCrews } = await import("./useCrews");
    const { result } = renderHook(() => useCrews());
    // The honest-empty rule: unknown is "not yet", never "there are none".
    expect(result.current.loaded).toBe(false);
    expect(result.current.crews).toEqual([]);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.crews).toHaveLength(1);
  });
});
