// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  OnboardingAgentOverview,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import type {
  ProviderCliStatusResponse,
  ProviderUsageResponse,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  crewDefaultsQueryKey,
  hostProviderCliStatusQueryKey,
  onboardingAgentsQueryKey,
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
  systemUsageLimitsQueryKey,
} from "./query-keys";
import {
  useHostProviderCliStatus,
  useOnboardingAgents,
  useSystemExecutionOptions,
  useSystemUsageLimits,
} from "./system-queries";

vi.mock("@/lib/sdk", () => ({
  BbHttpError: class BbHttpError extends Error {},
  sdk: {
    hosts: { providerCliStatus: vi.fn() },
    system: {
      executionOptions: vi.fn(),
      onboardingAgents: vi.fn(),
      usageLimits: vi.fn(),
    },
  },
}));

const EXECUTION_OPTIONS_RESPONSE: SystemExecutionOptionsResponse = {
  providers: [],
  models: [],
  selectedOnlyModels: [],
  permissionCeiling: "full",
  modelLoadError: null,
};

const PROVIDER_CLI_STATUS_RESPONSE = {} as ProviderCliStatusResponse;

function onboardingOverview(providerId: string): OnboardingAgentOverview {
  return {
    agents: [
      {
        providerId,
        displayName: providerId,
        status: "connected",
        planLabel: null,
        accountEmail: null,
        canInstall: false,
        loginCommand: null,
      },
    ],
  };
}

const PROVIDER_USAGE_RESPONSE: ProviderUsageResponse = {
  codex: { status: "unauthenticated" },
  claudeCode: { status: "unauthenticated" },
  cursor: { status: "unauthenticated" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function crewDefaultsFetchMock(result: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/**
 * Waits for the crew-defaults query itself to settle (success or error, not
 * merely fetching) rather than a fixed `setTimeout`, which can pass before
 * the query has actually resolved and would let a real regression through.
 */
async function waitForCrewDefaultsSettled(
  queryClient: QueryClient,
): Promise<void> {
  await waitFor(() => {
    const state = queryClient.getQueryState(crewDefaultsQueryKey());
    expect(state?.fetchStatus).toBe("idle");
    expect(state?.status).not.toBe("pending");
  });
}

describe("useSystemExecutionOptions", () => {
  it("separates requests and cache entries for different hosts", async () => {
    vi.mocked(sdk.system.executionOptions).mockImplementation(async (args) =>
      args?.hostId === "host-a"
        ? { ...EXECUTION_OPTIONS_RESPONSE, models: [] }
        : { ...EXECUTION_OPTIONS_RESPONSE, selectedOnlyModels: [] },
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(
      () => [
        useSystemExecutionOptions({ hostId: "host-a", providerId: "codex" }),
        useSystemExecutionOptions({ hostId: "host-b", providerId: "codex" }),
      ],
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host-a", providerId: "codex" }),
      );
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host-b", providerId: "codex" }),
      );
    });

    const hostAKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: "host-a",
      providerId: "codex",
    });
    const hostBKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: "host-b",
      providerId: "codex",
    });
    expect(hostAKey).not.toEqual(hostBKey);
    expect(queryClient.getQueryState(hostAKey)).toBeDefined();
    expect(queryClient.getQueryState(hostBKey)).toBeDefined();
    expect(systemProvidersQueryKey({ hostId: "host-a" })).not.toEqual(
      systemProvidersQueryKey({ hostId: "host-b" }),
    );
  });

  it("retries one transient failure before surfacing model selector errors", async () => {
    vi.mocked(sdk.system.executionOptions)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(EXECUTION_OPTIONS_RESPONSE);

    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () => useSystemExecutionOptions({ providerId: "codex" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toBe(EXECUTION_OPTIONS_RESPONSE);
      expect(sdk.system.executionOptions).toHaveBeenCalledTimes(2);
    });
  });

  it("does not retry intentionally aborted model selector requests", async () => {
    vi.mocked(sdk.system.executionOptions).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () => useSystemExecutionOptions({ providerId: "codex" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect(sdk.system.executionOptions).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useSystemExecutionOptions crew-defaults preload", () => {
  it("shows the crew plugin's stored pair provisionally before a slow catalog resolves", async () => {
    vi.stubGlobal(
      "fetch",
      crewDefaultsFetchMock({
        ok: true,
        stored: { providerId: "codex", modelId: "codex-mini" },
        providers: [{ id: "codex", displayName: "Codex", available: true }],
      }),
    );
    vi.mocked(sdk.system.executionOptions).mockImplementation(() =>
      neverResolves(),
    );
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(() => useSystemExecutionOptions({}), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.data?.providers[0]?.id).toBe("codex");
      expect(result.current.data?.models[0]?.model).toBe("codex-mini");
      expect(result.current.isPlaceholderData).toBe(true);
    });
  });

  it("replaces the provisional pair once the catalog resolves (the retirement law)", async () => {
    vi.stubGlobal(
      "fetch",
      crewDefaultsFetchMock({
        ok: true,
        stored: { providerId: "codex", modelId: "codex-mini" },
        providers: [{ id: "codex", displayName: "Codex", available: true }],
      }),
    );
    let resolveExecutionOptions!: (
      value: SystemExecutionOptionsResponse,
    ) => void;
    vi.mocked(sdk.system.executionOptions).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExecutionOptions = resolve;
        }),
    );
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(() => useSystemExecutionOptions({}), {
      wrapper,
    });

    // The provisional pair renders first, flagged as placeholder data.
    await waitFor(() => {
      expect(result.current.data?.providers[0]?.id).toBe("codex");
      expect(result.current.isPlaceholderData).toBe(true);
    });

    // Only a fresh probe may retire it — resolving the real (here: empty)
    // catalog must replace the provisional pair, not merely sit alongside it.
    resolveExecutionOptions(EXECUTION_OPTIONS_RESPONSE);

    await waitFor(() => {
      expect(result.current.isPlaceholderData).toBe(false);
      expect(result.current.data).toBe(EXECUTION_OPTIONS_RESPONSE);
    });
    expect(result.current.data?.providers).toEqual([]);
  });

  it("does not leak the stored pair into a different provider's query", async () => {
    const fetchMock = crewDefaultsFetchMock({
      ok: true,
      stored: { providerId: "codex", modelId: "codex-mini" },
      providers: [{ id: "codex", displayName: "Codex", available: true }],
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(sdk.system.executionOptions).mockImplementation(() =>
      neverResolves(),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () => useSystemExecutionOptions({ providerId: "some-other-provider" }),
      { wrapper },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitForCrewDefaultsSettled(queryClient);
    expect(result.current.data).toBeUndefined();
  });

  it("behaves exactly as today when the crew plugin is unreachable", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(sdk.system.executionOptions).mockImplementation(() =>
      neverResolves(),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(() => useSystemExecutionOptions({}), {
      wrapper,
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitForCrewDefaultsSettled(queryClient);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });
});

describe("useHostProviderCliStatus", () => {
  it("keeps host CLI status session-static", async () => {
    vi.mocked(sdk.hosts.providerCliStatus).mockResolvedValue(
      PROVIDER_CLI_STATUS_RESPONSE,
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(
      () => useHostProviderCliStatus({ hostId: "host-1", enabled: true }),
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.hosts.providerCliStatus).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: hostProviderCliStatusQueryKey("host-1"),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      }),
    );
  });
});

describe("useOnboardingAgents", () => {
  it("separates connected-provider results for different target machines", async () => {
    vi.mocked(sdk.system.onboardingAgents).mockImplementation(async (args) =>
      onboardingOverview(args?.hostId === "host-a" ? "codex" : "claude-code"),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () => [
        useOnboardingAgents({ hostId: "host-a", poll: false }),
        useOnboardingAgents({ hostId: "host-b", poll: false }),
      ],
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current[0]?.data?.agents[0]?.providerId).toBe("codex");
      expect(result.current[1]?.data?.agents[0]?.providerId).toBe(
        "claude-code",
      );
    });

    const hostAKey = onboardingAgentsQueryKey({
      environmentId: null,
      hostId: "host-a",
    });
    const hostBKey = onboardingAgentsQueryKey({
      environmentId: null,
      hostId: "host-b",
    });
    expect(hostAKey).not.toEqual(hostBKey);
    expect(queryClient.getQueryState(hostAKey)).toBeDefined();
    expect(queryClient.getQueryState(hostBKey)).toBeDefined();
  });

  it("routes reusable worktrees through their environment", async () => {
    vi.mocked(sdk.system.onboardingAgents).mockResolvedValue(
      onboardingOverview("claude-code"),
    );
    const { wrapper } = createQueryClientTestHarness();

    renderHook(
      () => useOnboardingAgents({ environmentId: "env-remote", poll: false }),
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.system.onboardingAgents).toHaveBeenCalledWith({
        environmentId: "env-remote",
        hostId: undefined,
        signal: expect.any(AbortSignal),
      });
    });
  });
});

describe("useSystemUsageLimits", () => {
  it("refreshes stale usage data on focus and reconnect", async () => {
    vi.mocked(sdk.system.usageLimits).mockResolvedValue(
      PROVIDER_USAGE_RESPONSE,
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(() => useSystemUsageLimits({ hostId: "host-1" }), { wrapper });

    await waitFor(() => {
      expect(sdk.system.usageLimits).toHaveBeenCalledTimes(1);
    });

    expect(sdk.system.usageLimits).toHaveBeenCalledWith({
      hostId: "host-1",
      signal: expect.any(AbortSignal),
    });

    const query = queryClient.getQueryCache().find({
      queryKey: systemUsageLimitsQueryKey("host-1"),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        staleTime: 30_000,
      }),
    );
  });
});
