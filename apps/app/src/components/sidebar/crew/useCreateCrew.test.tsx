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
  fleet?:
    | FleetRow[]
    | "unreadable"
    | "malformed"
    | "outer-not-ok"
    | "inner-not-ok"
    | "partial"
    | "no-handle-key";
  /** What the fleet says AFTER the charter — the other process's crew landing
   *  between our pre-check and our refusal is the race itself. */
  fleetAfterCharter?:
    | FleetRow[]
    | "unreadable"
    | "malformed"
    | "outer-not-ok"
    | "inner-not-ok"
    | "partial"
    | "no-handle-key";
  projects?: unknown[] | "unreadable";
  /** What POST /threads answers with — the crew is chartered onto this. */
  created?: unknown;
  createStatus?: number;
  createBody?: unknown;
  /** The create never answers, so only the deadline can end the press. */
  createHangs?: boolean;
  hosts?: unknown[];
  /** The thread list answers, but its BODY never finishes arriving. */
  threadsBodyHangs?: boolean;
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
  created = { id: "thr_root", projectId: "proj_a" },
  createStatus,
  createBody,
  createHangs = false,
  hosts = [{ id: "host_one" }],
  threadsBodyHangs = false,
}: RigOptions = {}) {
  let charterSeen = false;
  calls = [];
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (
      url: string,
      init?: { method?: string; body?: string; signal?: AbortSignal },
    ) => {
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
        if (view === "outer-not-ok") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: false, error: "port down" }),
          };
        }
        if (view === "inner-not-ok") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              result: { ok: false, error: "ledger unreadable" },
            }),
          };
        }
        const rows =
          view === "malformed"
            ? [{ handle: "AW-1" }]
            : view === "no-handle-key"
              ? [{ threadId: "thr_x", parentThreadId: null }]
              : view;
        // The plugin's own shape for a row it could not honour.
        const unreadable =
          view === "partial"
            ? [{ threadId: "thr_unreadable", error: "rank could not be read" }]
            : [];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: { ok: true, rows: view === "partial" ? [] : rows, unreadable },
          }),
        };
      }
      if (url.includes("crew_charter")) {
        // The real verb answers ABOUT the thread it was asked about, and the
        // flow refuses a success that names a different one — so the stub
        // echoes the id rather than asserting a fixed one.
        const askedFor = JSON.parse(init?.body ?? "{}") as {
          threadId?: string;
        };
        const success = {
          ok: true,
          result: { ...CHARTERED.result, threadId: askedFor.threadId },
        };
        // A configured answer belongs to the charter THIS invocation makes for
        // its own root — the one that can lose the race. The repair charter
        // that follows is a different call about the WINNER, and answering it
        // with the loser's refusal is a rig that cannot express the race at
        // all: nobody could ever be opened.
        const body = charterSeen ? success : (charter.body ?? success);
        const status = charterSeen ? 200 : (charter.status ?? 200);
        charterSeen = true;
        return { ok: status < 400, status, json: async () => body };
      }
      if (url.includes("/api/v1/threads")) {
        if (init?.method !== "POST" && threads === "unreadable") {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        if (init?.method === "POST" && createHangs) {
          return new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          });
        }
        if (init?.method === "POST" && createStatus !== undefined) {
          return {
            ok: createStatus < 400,
            status: createStatus,
            json: async () => createBody ?? {},
          };
        }
        return {
          ok: true,
          status: 200,
          json:
            init?.method !== "POST" && threadsBodyHangs
              ? () => new Promise(() => {})
              : async () => (init?.method === "POST" ? created : threads),
        };
      }
      if (url.includes("/api/v1/projects")) {
        if (projects === "unreadable") {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => projects };
      }
      if (url.includes("/api/v1/hosts")) {
        return { ok: true, status: 200, json: async () => hosts };
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
    // Restore any spy a previous test installed BEFORE it could fail: a
    // throwing localStorage left behind is invisible here and breaks every
    // test after it with an error message from somewhere else entirely.
    vi.restoreAllMocks();
    archive.mockClear();
    archive.mockImplementation(async () => ({ ok: true as const }));
    window.localStorage.clear();
  });
  afterEach(async () => {
    // Let a flow that is still unwinding finish against ITS OWN module
    // instance. `freshHook` re-imports per test, so an unfinished flow from
    // the previous one keeps running — and calls the SHARED navigate/send
    // spies while the next test is asserting they were never touched.
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
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
    // The root left behind by a failed charter is found by what this client
    // RECORDED creating — never by its title — and chartered again: one root
    // per project, however many times the button is pressed.
    window.localStorage.setItem(
      "bb.crew.standby-roots",
      JSON.stringify([{ threadId: "thr_standby", projectId: "proj_a" }]),
    );
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

    // Nothing CREATED. Chartered once, though: a handle proves a charter
    // started, not that its brief landed, so the repair runs before this root
    // is opened as if it were whole.
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
    expect(calls.filter((c) => c.includes("crew_charter"))).toHaveLength(1);
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

  it.each([
    ["a port that reports failure", "outer-not-ok" as const],
    ["a ledger that reports failure", "inner-not-ok" as const],
  ])("will not create on %s", async (_label, fleet) => {
    // Both levels must say ok. A transport that succeeded carrying a verb that
    // failed is still a fleet this code cannot read.
    stubRig({ fleet });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("Could not read the crew ledger");
    });
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
  });

  it("will not create when one thread row is unreadable", async () => {
    stubRig({ threads: [{ id: "thr_ok", projectId: "proj_a" }, { id: 7 }] });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("Could not read");
    });
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
  });

  it.each([
    ["no id", { projectId: "proj_a" }],
    ["an empty id", { id: "", projectId: "proj_a" }],
    ["another project", { id: "thr_root", projectId: "proj_elsewhere" }],
  ])("refuses to charter a created thread with %s", async (_label, created) => {
    // A root cannot move after it is made, so a thread that came back on the
    // wrong project is not something to charter and hand over. Either way a
    // thread EXISTS, and the message says so.
    stubRig({ created });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("A thread was created");
    });
    expect(result.current.error).toContain("cannot be built on it");
    expect(calls.filter((c) => c.includes("crew_charter"))).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["a truncated success", { ok: true, threadId: "thr_root" }],
    [
      "a success about another thread",
      { ...CHARTERED.result, threadId: "thr_other" },
    ],
    [
      "a success with no rank",
      { ...CHARTERED.result, rank: "" },
    ],
  ])("does not accept %s as a chartered crew", async (_label, result_) => {
    stubRig({ charter: { status: 200, body: { ok: true, result: result_ } } });
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

  it("charters the winner before opening it, not just the loser's own root", async () => {
    // The winner is opened the same way any existing root is: its handle
    // proves a charter started, never that its brief landed.
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
    // Ours refused, then the winner chartered: two charter calls, and the
    // second one is what makes the winner safe to open.
    await waitFor(() => {
      expect(calls.filter((c) => c.includes("crew_charter"))).toHaveLength(2);
    });
  });

  it("archives what it created when this browser cannot record it", async () => {
    // Without the note nothing can tell the thread from an ordinary chat
    // afterwards: no retry, no cleanup, no way back. So it is undone now.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is full");
    });
    stubRig();
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("could not record it");
    });
    expect(archive).toHaveBeenCalledWith({ threadId: "thr_root" });
    expect(calls.filter((c) => c.includes("crew_charter"))).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["the fleet reports rows it could not read", "partial" as const],
    ["a row is missing its handle key", "no-handle-key" as const],
  ])("will not create when %s", async (_label, fleet) => {
    // A partial fleet is an unreadable one: the row it dropped could be the
    // very root being asked about.
    stubRig({ fleet });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("Could not read the crew ledger");
    });
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
  });

  it("surfaces a bounded message from a refused create", async () => {
    stubRig({ createStatus: 409, createBody: { error: "that folder is busy" } });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toBe("that folder is busy");
    });
    expect(calls.filter((c) => c.includes("crew_charter"))).toEqual([]);
  });

  it("archives the thread it cannot build on rather than pretending none was made", async () => {
    // A thread WAS created. Saying "no crew was made" would leave a root
    // nobody is looking for.
    stubRig({ created: { id: "thr_stranded", projectId: "proj_elsewhere" } });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("was archived");
    });
    expect(archive).toHaveBeenCalledWith({ threadId: "thr_stranded" });
  });

  it("names an orphan it cannot even identify", async () => {
    stubRig({ created: { projectId: "proj_a" } });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("did not name it");
    });
    expect(archive).not.toHaveBeenCalled();
  });

  it.each([
    ["no providerId", { providerId: undefined }],
    ["no model", { model: undefined }],
    ["a lead that is not a record", { leads: ["thr_lead"] }],
  ])("does not accept a charter success with %s", async (_label, patch) => {
    const result_ = { ...CHARTERED.result, ...patch };
    if ("providerId" in patch && patch.providerId === undefined) {
      delete (result_ as Record<string, unknown>).providerId;
    }
    if ("model" in patch && patch.model === undefined) {
      delete (result_ as Record<string, unknown>).model;
    }
    stubRig({ charter: { status: 200, body: { ok: true, result: result_ } } });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("could not be chartered");
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["a project row with no id", { projects: [{ name: "Alpha" }] }],
    ["a host row with an empty id", { hosts: [{ id: "" }] }],
  ])("fails closed on %s", async (_label, rig) => {
    stubRig(rig);
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(calls.filter((c) => c === "POST /api/v1/threads")).toEqual([]);
  });

  it("warns of a root it cannot identify when the create itself times out", async () => {
    // The one ambiguous failure: the server may have committed the thread and
    // lost it on the way back, so there is no id to clean up by. Nothing here
    // ever answers — only the deadline can end the press, so the clock is run
    // forward rather than waited on.
    stubRig({ createHangs: true });
    const { result } = await freshHook();
    vi.useFakeTimers();
    try {
      act(() => {
        result.current.createCrew("proj_a");
      });
      await act(async () => {
        // Past REQUEST_TIMEOUT_MS, with the microtasks between each leg
        // flushed as the clock moves.
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(result.current.error).toContain("no id to clean it up by");
      // Nothing to archive: an id never came back.
      expect(archive).not.toHaveBeenCalled();
      // And the press is over, even though nothing ever answered.
      expect(result.current.creatingFor("proj_a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("archives a standby left behind before opening the crew that won", async () => {
    // A root recorded on an earlier press, or before a reload, or by the
    // losing half of a cross-process race. Once a governed crew exists the
    // card shows that crew and the Retry is gone with it, so nothing names
    // the leftover any more.
    window.localStorage.setItem(
      "bb.crew.standby-roots",
      JSON.stringify([{ threadId: "thr_leftover", projectId: "proj_a" }]),
    );
    stubRig({
      threads: [
        {
          id: "thr_leftover",
          title: "New crew",
          projectId: "proj_a",
          parentThreadId: null,
        },
        {
          id: "thr_winner",
          title: "Billing",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
      fleet: [{ threadId: "thr_winner", handle: "AW-9", parentThreadId: null }],
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    expect(archive).toHaveBeenCalledWith({ threadId: "thr_leftover" });
    expect(window.localStorage.getItem("bb.crew.standby-roots")).not.toContain(
      "thr_leftover",
    );
    // And the winner is still charter-proven before it is opened.
    expect(calls.filter((c) => c.includes("crew_charter"))).toHaveLength(1);
    const sent = send.mock.calls[0]?.[0] as unknown as SentTurn | undefined;
    expect(sent?.threadId ?? "thr_winner").toBe("thr_winner");
  });

  it("never archives a recorded root that has since moved to another project", async () => {
    // The note says where this client left a standby, not where the thread
    // lives now. Trusting it would archive a live root on someone else's
    // project — the one destructive mistake this cleanup could make.
    window.localStorage.setItem(
      "bb.crew.standby-roots",
      JSON.stringify([{ threadId: "thr_moved", projectId: "proj_a" }]),
    );
    stubRig({
      threads: [
        {
          id: "thr_moved",
          title: "New crew",
          projectId: "proj_elsewhere",
          parentThreadId: null,
        },
        {
          id: "thr_winner",
          title: "Billing",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
      fleet: [{ threadId: "thr_winner", handle: "AW-9", parentThreadId: null }],
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    expect(archive).not.toHaveBeenCalled();
    // The stale note is dropped without touching the thread it named.
    expect(window.localStorage.getItem("bb.crew.standby-roots")).not.toContain(
      "thr_moved",
    );
    expect(result.current.error).toBeNull();
  });

  it("keeps a leftover visible when it cannot be archived", async () => {
    // A leftover that is merely invisible is the thing being fixed, so the
    // winner is not opened past a cleanup that failed.
    archive.mockImplementation(async () => {
      throw new Error("archive route said no");
    });
    window.localStorage.setItem(
      "bb.crew.standby-roots",
      JSON.stringify([{ threadId: "thr_leftover", projectId: "proj_a" }]),
    );
    stubRig({
      threads: [
        {
          id: "thr_leftover",
          title: "New crew",
          projectId: "proj_a",
          parentThreadId: null,
        },
        {
          id: "thr_winner",
          title: "Billing",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
      fleet: [{ threadId: "thr_winner", handle: "AW-9", parentThreadId: null }],
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("thr_leftover");
    });

    expect(navigate).not.toHaveBeenCalled();
    // The note survives a failed cleanup: it is the only handle on the thread.
    expect(window.localStorage.getItem("bb.crew.standby-roots")).toContain(
      "thr_leftover",
    );
  });

  it("never archives its own standby once something has adopted it", async () => {
    // Between our charter losing and this cleanup, the thread we made can have
    // been reparented into a crew. It is a live governed descendant then, not
    // a loose standby, and archiving it would destroy somebody's agent.
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
        // Ours, adopted since it was created.
        {
          id: "thr_root",
          title: "New crew",
          projectId: "proj_a",
          parentThreadId: "thr_winner",
        },
      ],
    });
    const { result } = await freshHook();
    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("already has a crew");
    });

    expect(archive).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // No longer a standby of ours, so the note goes without destroying it.
    expect(window.localStorage.getItem("bb.crew.standby-roots")).not.toContain(
      "thr_root",
    );
  });

  it("clears busy with an honest error when the brief never arrives", async () => {
    // The brief gates the repair, the retry and every new charter. A lazy
    // chunk that never resolves left the button spinning with nothing said.
    vi.doMock("./rootAgentBootstrap.md?raw", () => new Promise(() => {}));
    stubRig();
    const { result } = await freshHook();
    vi.useFakeTimers();
    try {
      act(() => {
        result.current.createCrew("proj_a");
      });
      // Up to the point the brief is asked for, on no virtual time.
      await act(async () => {
        for (
          let i = 0;
          i < 200 && !calls.includes("POST /api/v1/threads");
          i += 1
        ) {
          await vi.advanceTimersByTimeAsync(0);
        }
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(result.current.error).toContain("crew brief");
      expect(result.current.creatingFor("proj_a")).toBe(false);
      // Nothing was chartered on a brief that never arrived.
      expect(calls.filter((c) => c.includes("crew_charter"))).toEqual([]);
    } finally {
      vi.useRealTimers();
      vi.doUnmock("./rootAgentBootstrap.md?raw");
    }
  });

  it("clears busy when a response BODY never finishes arriving", async () => {
    // Aborting the request does not bound the read of its body; only the
    // deadline does.
    stubRig({ threadsBodyHangs: true });
    const { result } = await freshHook();
    vi.useFakeTimers();
    try {
      act(() => {
        result.current.createCrew("proj_a");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(result.current.error).toContain("Could not read");
      expect(result.current.creatingFor("proj_a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears busy when the losing archive never answers", async () => {
    archive.mockImplementation(() => new Promise(() => {}));
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
    // The brief is loaded by dynamic import, and this is the only fake-clock
    // case that has to get PAST the charter to reach its seam — the other two
    // stall before it. A module that has not been resolved yet cannot resolve
    // while the clock is frozen, so it is warmed on real time first; without
    // this the flow simply stops at the charter and nothing is ever archived.
    await import("./rootAgentBootstrap.md?raw");
    vi.useFakeTimers();
    try {
      act(() => {
        result.current.createCrew("proj_a");
      });
      // The archive is several awaited legs in — create, charter, a second
      // fleet read — and its deadline timer does not exist until it is
      // reached. Spending the clock first ran the whole 20s out before there
      // was anything to time out. Drive the flow to the seam on zero virtual
      // time, prove it arrived, THEN run out its deadline.
      await act(async () => {
        for (let i = 0; i < 200 && archive.mock.calls.length === 0; i += 1) {
          await vi.advanceTimersByTimeAsync(0);
        }
      });
      expect(archive).toHaveBeenCalledWith({ threadId: "thr_root" });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(result.current.error).toContain("could not be archived");
      expect(result.current.creatingFor("proj_a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
