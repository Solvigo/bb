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
const send = vi.hoisted(() =>
  vi.fn(async (_turn: { threadId: string; input: unknown[]; mode: string }) =>
    undefined,
  ),
);
vi.mock("@/lib/sdk", () => ({ sdk: { threads: { send } } }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigate };
});

import { useCreateCrew } from "./useCreateCrew";
import rootBootstrap from "./rootAgentBootstrap.md?raw";

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
  threads?: unknown[];
  charter?: { status?: number; body?: unknown };
  fleet?: FleetRow[];
}

/** The POST bodies the flow sent, by url, so a test can read what was asked. */
let posted: { url: string; body: Record<string, unknown> }[] = [];

function stubRig({ threads = [], charter = {}, fleet = [] }: RigOptions = {}) {
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
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { rows: fleet } }),
        };
      }
      if (url.includes("crew_charter")) {
        return {
          ok: (charter.status ?? 200) < 400,
          status: charter.status ?? 200,
          json: async () => charter.body ?? { ok: true },
        };
      }
      if (url.includes("/api/v1/threads")) {
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
        return { ok: true, status: 200, json: async () => [{ id: "proj_a" }] };
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
    const { result } = renderHook(() => useCreateCrew(), { wrapper });

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
    const { result } = renderHook(() => useCreateCrew(), { wrapper });

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
    const { result } = renderHook(() => useCreateCrew(), { wrapper });

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

  it("downgrades a refusal only when the fleet shows THIS thread already chartered", async () => {
    // Charter is a one-way door, so a refusal on a root that is already crew
    // is a successful retry. What proves it is the fleet listing this exact
    // thread as a handled root — never the refusal's wording, which for a
    // different reason reads almost the same.
    stubRig({
      threads: [
        {
          id: "thr_live",
          title: "New crew",
          projectId: "proj_a",
          parentThreadId: null,
        },
      ],
      charter: {
        status: 200,
        body: {
          result: { ok: false, error: "refused, in words nobody should parse" },
        },
      },
      fleet: [
        { threadId: "thr_live", handle: "AW-1", parentThreadId: null },
      ],
    });
    const { result } = renderHook(() => useCreateCrew(), { wrapper });

    act(() => {
      result.current.createCrew("proj_a", "ship the billing page");
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    expect(result.current.error).toBeNull();
    // Already chartered means already briefed: it gets the request, not the
    // brief a second time.
    const sent = send.mock.calls[0][0] as unknown as SentTurn;
    expect(sent.input).toHaveLength(1);
    expect(sent.input[0]?.text).toContain("ship the billing page");
  });

  it("keeps the refusal when the project's crew is a DIFFERENT thread", async () => {
    // The refusal that reads most like success: this project already has a
    // crew — held by somebody else. The fleet has a handled root for the
    // project, just not ours, so nothing here is a retry.
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
      charter: {
        status: 200,
        body: {
          result: {
            ok: false,
            error: "charter: this project already has a crew — AW-9 is live.",
          },
        },
      },
      fleet: [
        { threadId: "thr_theirs", handle: "AW-9", parentThreadId: null },
      ],
    });
    const { result } = renderHook(() => useCreateCrew(), { wrapper });

    act(() => {
      result.current.createCrew("proj_a");
    });
    await waitFor(() => {
      expect(result.current.error).toContain("already has a crew");
    });

    expect(send).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps the refusal when the fleet knows our thread but it carries no handle", async () => {
    // Present in the fleet is not the same as governed. A row with no handle
    // is a thread the crew ledger has seen, not a chartered root.
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
    const { result } = renderHook(() => useCreateCrew(), { wrapper });

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
