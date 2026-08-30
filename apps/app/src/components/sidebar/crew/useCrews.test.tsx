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
  {
    id: "thr_cmd",
    title: "Commander · Airways",
    projectId: "p",
    parentThreadId: null,
  },
  {
    id: "thr_lead",
    title: "Lead · shell",
    projectId: "p",
    parentThreadId: "thr_cmd",
  },
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
      expect(
        calls.filter(([u]) => String(u).includes("/threads")),
      ).toHaveLength(1);
    });
  });

  it("says the fleet is slow, not broken, when it simply has not answered", async () => {
    // These need different words and different remedies. Collapsing them once
    // sent a live incident looking for a fault that was really just a loaded
    // machine — the box running this app also runs the fleet's CI.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              );
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
  it("rolls an ask on a sortie up through its lead to the pilot", async () => {
    // The rig this was built on has no crew three deep, so the roll-up cannot
    // be seen there — and a badge that only counts an agent's OWN asks looks
    // identical on a two-level fleet. This is the case that tells them apart.
    const DEEP = [
      {
        id: "thr_cmd",
        title: "Commander",
        projectId: "p",
        parentThreadId: null,
      },
      {
        id: "thr_lead",
        title: "Lead",
        projectId: "p",
        parentThreadId: "thr_cmd",
      },
      {
        id: "thr_sortie",
        title: "Sortie",
        projectId: "p",
        parentThreadId: "thr_lead",
      },
    ];
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/threads")) {
          return { ok: true, json: async () => DEEP };
        }
        if (url.includes("crew_attention")) {
          return {
            ok: true,
            json: async () => ({
              result: {
                open: [
                  { threadId: "thr_sortie", audience: "operator" },
                  // Not the operator's to clear, so it must not be counted.
                  { threadId: "thr_lead", audience: "agent" },
                ],
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ result: { rows: [] } }) };
      }),
    );

    const { useCrews } = await import("./useCrews");
    const { result } = renderHook(() => useCrews());

    await waitFor(() => {
      expect(result.current.crews[0]?.attention).toBe(1);
    });

    const crew = result.current.crews[0];
    const lead = crew?.leads[0];
    expect(lead?.attention).toBe(1);
    expect(lead?.sorties[0]?.attention).toBe(1);
    // The pilot counts the sortie's ask and ignores the one addressed to an
    // agent, so the number he sees is the number he can actually clear.
    expect(crew?.attention).toBe(1);
  });
  it("builds the operator's example shape from parent pointers alone", async () => {
    // root -> child -> three siblings under that child. The structure is the
    // pointer and nothing else: no rank is sent, and the tree still comes out
    // the right shape at the right depths.
    const SHAPE = [
      { id: "thr_root", title: "root", projectId: "p", parentThreadId: null },
      {
        id: "thr_child",
        title: "child",
        projectId: "p",
        parentThreadId: "thr_root",
      },
      {
        id: "thr_s1",
        title: "sib one",
        projectId: "p",
        parentThreadId: "thr_child",
      },
      {
        id: "thr_s2",
        title: "sib two",
        projectId: "p",
        parentThreadId: "thr_child",
      },
      {
        id: "thr_s3",
        title: "sib three",
        projectId: "p",
        parentThreadId: "thr_child",
      },
    ];
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/threads"))
          return { ok: true, json: async () => SHAPE };
        if (url.includes("crew_attention")) {
          return {
            ok: true,
            json: async () => ({
              result: { open: [{ threadId: "thr_s3", audience: "operator" }] },
            }),
          };
        }
        return { ok: true, json: async () => ({ result: { rows: [] } }) };
      }),
    );

    const { useCrews } = await import("./useCrews");
    const { result } = renderHook(() => useCrews());
    await waitFor(() => {
      expect(result.current.crews[0]?.leads.length).toBe(1);
    });

    const root = result.current.crews[0];
    const child = root?.leads[0];
    expect(child?.name).toBe("child");
    // Three siblings, all under the one child, all at the same depth.
    expect(child?.sorties.map((s) => s.name).sort()).toEqual([
      "sib one",
      "sib three",
      "sib two",
    ]);
    // An ask on ONE sibling rolls up the whole ancestor chain and nowhere else.
    const asked = child?.sorties.find((s) => s.name === "sib three");
    const quiet = child?.sorties.find((s) => s.name === "sib one");
    expect(asked?.attention).toBe(1);
    expect(quiet?.attention).toBe(0);
    expect(child?.attention).toBe(1);
    expect(root?.attention).toBe(1);
  });

  it("shows a dragged root once while the move is still in the air", async () => {
    // The defect this guards: `roots` read the SERVER's parent pointer while
    // every other read honoured the optimistic one. Drag one root onto another
    // and the dragged agent rendered twice — as its new parent's child in
    // Projects, and as an untouched loose chat in Chats — until the server
    // answered. Two rows, one agent, and no way to tell which was real.
    const PAIR = [
      { id: "thr_a", title: "alpha", projectId: "p", parentThreadId: null },
      { id: "thr_b", title: "beta", projectId: "p", parentThreadId: null },
    ];
    vi.unstubAllGlobals();
    vi.resetModules();
    // The reparent call never settles, so the assertions run inside the
    // optimistic window rather than after the server has confirmed anything.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("crew_reparent")) return new Promise(() => {});
        if (url.includes("/threads"))
          return { ok: true, json: async () => PAIR };
        return { ok: true, json: async () => ({ result: { rows: [] } }) };
      }),
    );

    const { useCrews, reparentAgent } = await import("./useCrews");
    const { result } = renderHook(() => useCrews());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(2);
    });

    act(() => {
      void reparentAgent("thr_b", "thr_a");
    });

    await waitFor(() => {
      expect(result.current.crews.length).toBe(1);
    });
    expect(result.current.crews[0]?.commanderThreadId).toBe("thr_a");
    expect(result.current.crews[0]?.leads.map((l) => l.name)).toEqual(["beta"]);
    // The whole point: beta moved, so it is no longer standing in Chats too.
    expect(result.current.chats.map((c) => c.threadId)).toEqual([]);
  });

  it("promotes an agent to root the moment it is dropped there", async () => {
    // The mirror of the same defect: dropping a child onto the project root
    // cleared its optimistic parent, but `roots` still saw the server's old
    // pointer, so the agent belonged to nobody and rendered nowhere.
    const NESTED = [
      { id: "thr_a", title: "alpha", projectId: "p", parentThreadId: null },
      { id: "thr_b", title: "beta", projectId: "p", parentThreadId: "thr_a" },
    ];
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("crew_reparent")) return new Promise(() => {});
        if (url.includes("/threads"))
          return { ok: true, json: async () => NESTED };
        return { ok: true, json: async () => ({ result: { rows: [] } }) };
      }),
    );

    const { useCrews, reparentAgent } = await import("./useCrews");
    const { result } = renderHook(() => useCrews());
    await waitFor(() => {
      expect(result.current.crews.length).toBe(1);
    });

    act(() => {
      void reparentAgent("thr_b", null);
    });

    await waitFor(() => {
      expect(result.current.chats.map((c) => c.threadId).sort()).toEqual([
        "thr_a",
        "thr_b",
      ]);
    });
    expect(result.current.crews.length).toBe(0);
  });

  it("nests as deep as the pointers go", async () => {
    // Five levels. Nothing in the tree caps depth, and the roll-up has to climb
    // all of it — the deepest ask must be visible on the root.
    const DEEP = Array.from({ length: 5 }, (_, i) => ({
      id: `thr_${i}`,
      title: `level ${i}`,
      projectId: "p",
      parentThreadId: i === 0 ? null : `thr_${i - 1}`,
    }));
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/threads"))
          return { ok: true, json: async () => DEEP };
        if (url.includes("crew_attention")) {
          return {
            ok: true,
            json: async () => ({
              result: { open: [{ threadId: "thr_4", audience: "operator" }] },
            }),
          };
        }
        return { ok: true, json: async () => ({ result: { rows: [] } }) };
      }),
    );

    const { useCrews } = await import("./useCrews");
    const { result } = renderHook(() => useCrews());
    await waitFor(() => {
      expect(result.current.crews[0]?.attention).toBe(1);
    });

    let node = result.current.crews[0]?.leads[0];
    const names = [node?.name];
    for (let depth = 0; depth < 3; depth += 1) {
      node = node?.sorties[0];
      names.push(node?.name);
    }
    expect(names).toEqual(["level 1", "level 2", "level 3", "level 4"]);
    // The ask sits five levels down and is still counted at the root.
    expect(node?.attention).toBe(1);
    expect(result.current.crews[0]?.attention).toBe(1);
  });
});
