// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SentTurn {
  threadId: string;
  input: { type: string; text: string }[];
  mode: string;
}
// useCreateCrew reads the root titles from useCrews, which reaches the socket
// manager on import. Nothing here subscribes, so a stub is enough.
vi.mock("@/lib/ws", () => ({
  wsManager: { onPluginSignal: () => () => {}, onChanged: () => () => {} },
}));

const send = vi.hoisted(() =>
  vi.fn(async (_turn: { threadId: string; input: unknown[]; mode: string }) =>
    undefined,
  ),
);
const archive = vi.hoisted(() =>
  vi.fn(async (_args: { threadId: string }) => ({ ok: true as const })),
);
vi.mock("@/lib/sdk", () => ({ sdk: { threads: { send, archive } } }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigate };
});

import rootBootstrap from "./rootAgentBootstrap.md?raw";

/**
 * A FRESH module per test.
 *
 * The in-flight project set is module state by design — it is what stops two
 * surfaces creating two roots — so a test whose flow has not finished unwinding
 * leaves the next one's press refused before it starts. Re-importing isolates
 * them instead of making each test guess how long to wait.
 */
async function freshHook() {
  vi.resetModules();
  const { useCreateCrew } = await import("./useCreateCrew");
  return renderHook(() => useCreateCrew(), { wrapper });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

/** Every call the flow makes, in the order it made them. */
let calls: string[] = [];

interface FleetRow {
  threadId: string;
  handle: string | null;
  parentThreadId: string | null;
}

interface RigOptions {
  threads?: unknown[] | "unreadable";
  charter?: { status?: number; body?: unknown };
  fleet?: FleetRow[] | "unreadable" | "malformed";
  /** What the fleet says AFTER the charter — the other process's crew landing
   *  between our pre-check and our refusal is the race itself. */
  fleetAfterCharter?: FleetRow[] | "unreadable" | "malformed";
  projects?: unknown[] | "unreadable";
}

/** The shape crew_charter actually answers with: a discriminated union on `ok`
 *  inside the plugin port's own `{ ok, result }` envelope. */
const CHARTERED = {
  ok: true,
  result: {
    ok: true,
    threadId: "thr_root",
    handle: "AW-1",
    domain: null,
    rank: "commander",
    derivedRank: "commander",
    depth: 0,
    providerId: "anthropic",
    model: "claude",
    briefWrittenTo: "/w/.bb/brief.md",
    leads: [],
  },
};

/** The POST bodies the flow sent, by url, so a test can read what was asked. */
let posted: { url: string; body: Record<string, unknown> }[] = [];

function stubRig({
  threads = [],
  charter = {},
  fleet = [],
  fleetAfterCharter,
  projects = [{ id: "proj_a" }],
}: RigOptions = {}) {
  let charterSeen = false;
  calls = [];
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST" && init.body) {
        posted.push({
          url,
          body: JSON.parse(init.body) as Record<string, unknown>,
        });
      }
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("crew_fleet")) {
        const view =
          charterSeen && fleetAfterCharter !== undefined
            ? fleetAfterCharter
            : fleet;
        if (view === "unreadable") {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        const rows = view === "malformed" ? [{ handle: "AW-1" }] : view;
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { ok: true, rows } }),
        };
      }
      if (url.includes("crew_charter")) {
        charterSeen = true;
        return {
          ok: (charter.status ?? 200) < 400,
          status: charter.status ?? 200,
          json: async () => charter.body ?? CHARTERED,
        };
      }
      if (url.includes("/api/v1/threads")) {
        if (init?.method !== "POST" && threads === "unreadable") {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () =>
            init?.method === "POST"
              ? { id: "thr_root", projectId: "proj_a" }
              : threads,
        };
      }
      if (url.includes("/api/v1/projects")) {
        if (projects === "unreadable") {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => projects };
      }
      if (url.includes("/api/v1/hosts")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "host_one" }],
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function createBody(): Record<string, unknown> {
  return posted.find((p) => p.url.includes("/api/v1/threads"))?.body ?? {};
}

describe("useCreateCrew", () => {
  beforeEach(() => {
    send.mockClear();
    navigate.mockClear();
    archive.mockClear();
    archive.mockImplementation(async () => ({ ok: true as const }));
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("charters the root before it is ever told to work", async () => {
    // The whole contract in one order: a project-bound, worktree-less root is
    // created on standby, chartered, and only then given its brief. A brief
    // that went out with the create would have started a loose thread that the
    // charter had not yet made into anything.
    stubRig();
    const { result } = await freshHook();

    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    const body = createBody();
    expect(body.projectId).toBe("proj_a");
    expect(body.environment).toEqual({
      type: "host",
      hostId: "host_one",
      workspace: { type: "unmanaged", path: null },
    });
    const firstInput = (body.input as { text: string }[])[0]?.text ?? "";
    expect(firstInput).toContain("Stand by");
    // Not the brief, and nothing that reads as an order to begin.
    expect(firstInput).not.toBe(rootBootstrap);
    expect(firstInput).not.toContain("bb crew spawn");

    const charterIndex = calls.findIndex((c) => c.includes("crew_charter"));
    const createIndex = calls.indexOf("POST /api/v1/threads");
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(charterIndex).toBeGreaterThan(createIndex);

    // The brief arrives only after the charter, as its own send.
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0] as unknown as SentTurn;
    expect(sent.threadId).toBe("thr_root");
    expect(sent.input[0]?.text).toBe(rootBootstrap);
  });

  it("carries the charter's refusal to the operator and starts nothing", async () => {
    stubRig({
      charter: {
        status: 200,
        body: {
          result: { ok: false, error: "This project already has a crew." },
        },
      },
    });
    const { result } = await freshHook();

    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toBe("This project already has a crew.");
    });

    // Never briefed, never opened: an unchartered root is not a crew root, and
    // presenting it as one is what the charter exists to stop.
    expect(send).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("retries the charter on the same standby root instead of making a second", async () => {
    // The root left behind by a failed charter is found by title and chartered
    // again — one root per project, however many times the button is pressed.
    stubRig({
      threads: [
        {
          id: "thr_standby",
          title: "New crew",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
    });
    const { result } = await freshHook();

    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
    expect(calls.filter((c) => c.includes("crew_charter")).length).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("opens the crew this project already has instead of standing up a second", async () => {
    // The root was named by its crew long ago, so the title check cannot see
    // it. Before the fleet was asked first, this pressed on and left a standby
    // behind for a charter that was always going to be refused.
    stubRig({
      threads: [
        {
          id: "thr_live",
          title: "Billing crew",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
      fleet: [{ threadId: "thr_live", handle: "AW-1", parentThreadId: null }],
    });
    const { result } = await freshHook();

    act(() => {
      result.current.createCrew("proj_a", "ship the billing page");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    // Nothing created, nothing chartered: it is already a crew.
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
    expect(calls.filter((c) => c.includes("crew_charter"))).toEqual([]);
    // Already briefed when it was chartered; it gets the request only.
    const sent = send.mock.calls[0][0] as unknown as SentTurn;
    expect(sent.threadId).toBe("thr_live");
    expect(sent.input).toHaveLength(1);
    expect(sent.input[0]?.text).toContain("ship the billing page");
    expect(result.current.error).toBeNull();
  });

  it("does not treat ANOTHER thread's crew as this standby being chartered", async () => {
    // The refusal that reads most like success: this project already has a
    // crew — held by somebody else. Our own standby is not that crew, so it is
    // never briefed on the strength of someone else's handle.
    stubRig({
      threads: [
        {
          id: "thr_ours",
          title: "New crew",
          projectId: "proj_a",
          parentThreadId: null,
        },
        {
          id: "thr_theirs",
          title: "Billing",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
      fleet: [{ threadId: "thr_theirs", handle: "AW-9", parentThreadId: null }],
    });
    const { result } = await freshHook();

    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
    // The project's actual crew is what opens — never our unchartered standby.
    const sent = send.mock.calls[0]?.[0] as unknown as SentTurn | undefined;
    expect(sent?.threadId ?? null).not.toBe("thr_ours");
  });

  it("will not create when the crew ledger cannot be read", async () => {
    // Uncertainty is not "there is no crew". Creating on a fleet that did not
    // answer is how a project ends up with two roots.
    stubRig({ fleet: "unreadable" });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("Could not read the crew ledger");
    });
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
  });

  it("treats a malformed fleet row as an unreadable fleet, not an empty one", async () => {
    // The row that failed to parse could be the very root being asked about.
    stubRig({ fleet: "malformed" });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("Could not read the crew ledger");
    });
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
  });

  it("refuses a named project that is no longer on the rig", async () => {
    // Falling back to Personal built the crew somewhere the operator did not
    // ask for, on a project it can never leave.
    stubRig({ projects: [{ id: "proj_other" }] });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("no longer on this rig");
    });
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
  });

  it("does not accept a handle-without-brief charter as success", async () => {
    // charter writes the handle BEFORE the brief and refuses if the brief
    // fails, so this exact refusal means a half-made root. Accepting it
    // briefed a root whose brief had never been stored.
    stubRig({
      charter: {
        status: 200,
        body: {
          ok: true,
          result: {
            ok: false,
            error:
              "charter: thr_root now has its floor, ceiling and handle, but its brief could not be delivered",
          },
        },
      },
      fleet: [{ threadId: "thr_root", handle: "AW-1", parentThreadId: null }],
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("could not be delivered");
    });
    expect(send).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reads an object-shaped transport error without rendering [object Object]", async () => {
    stubRig({
      charter: {
        status: 200,
        body: { ok: false, error: { message: "the port fell over" } },
      },
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toBe("the port fell over");
    });
  });

  it("archives its own losing standby and opens the winner", async () => {
    // Two processes, one project. The loser must not leave a husk on the rail
    // that nobody can tell from a real root.
    stubRig({
      charter: {
        status: 200,
        body: {
          ok: true,
          result: { ok: false, error: "this project already has a crew" },
        },
      },
      fleetAfterCharter: [
        { threadId: "thr_winner", handle: "AW-9", parentThreadId: null },
      ],
      threads: [
        {
          id: "thr_winner",
          title: "Billing",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    // Ours archived, the authoritative winner opened.
    expect(archive).toHaveBeenCalledWith({ threadId: "thr_root" });
    const sent = send.mock.calls[0]?.[0] as unknown as SentTurn | undefined;
    expect(sent?.threadId ?? "thr_winner").toBe("thr_winner");
    expect(result.current.error).toBeNull();
  });

  it("names the orphan out loud when archiving the loser fails", async () => {
    archive.mockImplementation(async () => {
      throw new Error("archive route said no");
    });
    stubRig({
      charter: {
        status: 200,
        body: {
          ok: true,
          result: { ok: false, error: "this project already has a crew" },
        },
      },
      fleetAfterCharter: [
        { threadId: "thr_winner", handle: "AW-9", parentThreadId: null },
      ],
      threads: [
        {
          id: "thr_winner",
          title: "Billing",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("thr_root");
    });
    expect(result.current.error).toContain("could not be archived");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not archive anything when the fleet cannot say who won", async () => {
    // Fail closed: an unreadable fleet is never grounds to destroy a thread.
    stubRig({
      charter: {
        status: 200,
        body: { ok: true, result: { ok: false, error: "charter refused" } },
      },
      fleetAfterCharter: "unreadable",
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toBe("charter refused");
    });
    expect(archive).not.toHaveBeenCalled();
  });

  it("keeps busy state per project", async () => {
    stubRig();
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.creatingFor("proj_a")).toBe(true);
    });
    // Project B has nothing in flight and must keep its own affordance.
    expect(result.current.creatingFor("proj_b")).toBe(false);
  });

  it("will not create anything when the thread list cannot be read", async () => {
    // An unread list used to answer "no threads", which is the answer that
    // creates a duplicate root — silently, and precisely when the rig is
    // already having a bad minute.
    stubRig({ threads: "unreadable" });
    const { result } = await freshHook();

    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("Could not read");
    });

    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not read a 200 with no stated success as a chartered crew", async () => {
    // A truncated, empty, or unrecognised body is not a charter. Treating it
    // as one is how an ungoverned root gets briefed and opened as a crew.
    stubRig({ charter: { status: 200, body: {} } });
    const { result } = await freshHook();

    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("could not be chartered");
    });

    expect(send).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("makes one root when two surfaces press for the same project at once", async () => {
    // `creating` is per-component state and the rail and the project card each
    // hold their own, so both saw an idle flag and both created a root.
    stubRig();
    // Both from the SAME module instance: the shared set is the thing under
    // test, so re-importing between them would defeat the point.
    vi.resetModules();
    const { useCreateCrew } = await import("./useCreateCrew");
    const rail = renderHook(() => useCreateCrew(), { wrapper });
    const card = renderHook(() => useCreateCrew(), { wrapper });

    act(() => {
      rail.result.current.createCrew("proj_a");
      card.result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    expect(calls.filter((c) => c === "POST /api/v1/threads")).toHaveLength(1);
  });

  it("keeps the refusal when our thread is in the fleet without a handle", async () => {
    // Present in the fleet is not the same as governed. A row with no handle
    // is a thread the crew ledger has seen, not a chartered root, so neither
    // the pre-check nor the refusal downgrade may accept it.
    stubRig({
      threads: [
        {
          id: "thr_ours",
          title: "New crew",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
      charter: {
        status: 200,
        body: { result: { ok: false, error: "charter refused" } },
      },
      fleet: [{ threadId: "thr_ours", handle: null, parentThreadId: null }],
    });
    const { result } = await freshHook();

    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toBe("charter refused");
    });

    expect(send).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
