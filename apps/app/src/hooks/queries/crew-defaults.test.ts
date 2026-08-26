// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useCrewDefaults } from "./crew-defaults";

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCrewDefaults", () => {
  it("returns the stored pair and provider list on a well-formed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: {
          ok: true,
          stored: { providerId: "claude-code", modelId: "claude-sonnet-5" },
          providers: [{ id: "codex", displayName: "Codex", available: true }],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(() => useCrewDefaults(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        providerId: "claude-code",
        modelId: "claude-sonnet-5",
        providers: [{ id: "codex", displayName: "Codex", available: true }],
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/plugins/crew/rpc/crew_defaults");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("null");
    // `fetchWithAppSurface` normalizes the plain headers object it's handed
    // into a `Headers` instance, so read the merged result back through one
    // rather than asserting exact object identity/shape.
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("returns null when the plugin is absent (non-2xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, { status: 404 })),
    );
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(() => useCrewDefaults(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
  });

  it("returns null on a malformed result body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ ok: true, result: { ok: true, stored: null } }),
      ),
    );
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(() => useCrewDefaults(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
  });

  it("returns null rather than throwing when the request errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(() => useCrewDefaults(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeNull();
  });
});
