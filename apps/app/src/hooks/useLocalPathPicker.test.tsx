// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalPathPicker } from "./useLocalPathPicker";

const mocks = vi.hoisted(() => ({
  hosts: undefined as Host[] | undefined,
  isLoadingHosts: false,
  pickFolder: vi.fn(),
  primaryHost: null as Host | null,
  supportsNativeFolderPicker: true,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localDaemonHostId: "host_atum",
    localHostId: "host_atum",
    hasDaemon: true,
    supportsNativeFolderPicker: mocks.supportsNativeFolderPicker,
    platform: "linux",
    isLocalDaemonHost: (hostId: string | null) => hostId === "host_atum",
  }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: mocks.hosts, isPending: mocks.isLoadingHosts }),
  usePrimaryHost: () => mocks.primaryHost,
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { pickFolder: mocks.pickFolder } },
}));

const atum: Host = {
  id: "host_atum",
  name: "atum",
  type: "persistent",
  status: "connected",
  lastSeenAt: null,
  maxPermissionMode: "full",
  lastRejectedProtocolVersion: null,
  createdAt: 0,
  updatedAt: 0,
};

function host(
  id: string,
  name: string,
  status: Host["status"] = "connected",
): Host {
  return { ...atum, id, name, status };
}

beforeEach(() => {
  // The native picker belongs to the desktop shell; these cases are about
  // what it does once it is legitimately in play.
  (window as unknown as { bbDesktop?: unknown }).bbDesktop = {
    platform: "macos",
  };
  mocks.primaryHost = atum;
  mocks.supportsNativeFolderPicker = true;
  mocks.hosts = [atum];
  mocks.isLoadingHosts = false;
  mocks.pickFolder.mockResolvedValue({ path: "/home/me/repo" });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { bbDesktop?: unknown }).bbDesktop;
  vi.clearAllMocks();
});

describe("useLocalPathPicker", () => {
  // The dialog reports the machine it actually resolved a path on. An explicit
  // null means "no machine selected" and must not silently fall back to the
  // primary host — the create would land on the wrong machine.
  it("drops a submit that carries no machine", () => {
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit }),
    );

    act(() => {
      result.current.submitProjectPath({ kind: "create" }, "/srv/thing", null);
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it("submits on the machine the dialog reports", () => {
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit }),
    );

    act(() => {
      result.current.submitProjectPath(
        { kind: "create" },
        "/srv/thing",
        "host_kunst",
      );
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host_kunst", path: "/srv/thing" }),
    );
  });

  it("still submits on the primary host after the native folder picker", async () => {
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit }),
    );

    act(() => {
      result.current.openPicker({ kind: "create" });
    });

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host_atum", path: "/home/me/repo" }),
      );
    });
  });
});

/**
 * Choosing between the native folder picker and the in-app dialog. This lived
 * in `useQuickCreateProject` until onboarding needed the same behavior; it is
 * shared here so every path-entry caller agrees.
 */
describe("useLocalPathPicker openPathEntry", () => {
  it("opens the dialog instead of the native picker when several machines exist", () => {
    mocks.hosts = [atum, host("host_thoth", "Thoth")];
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(result.current.projectPathDialog.isOpen).toBe(true);
    expect(mocks.pickFolder).not.toHaveBeenCalled();
  });

  it("uses the native picker with one machine", () => {
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(mocks.pickFolder).toHaveBeenCalled();
    expect(result.current.projectPathDialog.isOpen).toBe(false);
  });

  it("never asks the host for a native panel from a browser tab", async () => {
    // THE DEFECT, as served: the host could raise an AppleScript folder panel
    // and the app asked it to — from a browser tab, where the operator could
    // not see or answer it. The press looked dead, then the in-app browser
    // arrived seconds later when the request gave up.
    delete (window as unknown as { bbDesktop?: unknown }).bbDesktop;
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => {
      result.current.openPathEntry({ kind: "create" });
    });

    expect(mocks.pickFolder).not.toHaveBeenCalled();
    // Straight to the surface a browser can actually show.
    expect(result.current.projectPathDialog.target).toEqual({ kind: "create" });
  });

  it("falls back to the in-app dialog when the native picker returns no path", async () => {
    // THE DEFECT: a daemon that advertises the native picker and then answers
    // null — no desktop shell in front of it, or a cancelled picker — made the
    // press do literally nothing. No dialog, no message, no error, on a button
    // that looked perfectly enabled.
    mocks.pickFolder.mockResolvedValue({ path: null });
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit }),
    );

    act(() => {
      result.current.openPathEntry({ kind: "create" });
    });

    await waitFor(() => {
      expect(result.current.projectPathDialog.target).toEqual({
        kind: "create",
      });
    });
    // The absence of a path is not a path: nothing is submitted.
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps the native picker when the only other machine is offline", () => {
    mocks.hosts = [atum, host("host_dead", "Old laptop", "disconnected")];
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(mocks.pickFolder).toHaveBeenCalled();
    expect(result.current.projectPathDialog.isOpen).toBe(false);
  });

  it("opens the dialog while the machine list is still loading", () => {
    mocks.hosts = undefined;
    mocks.isLoadingHosts = true;
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(result.current.projectPathDialog.isOpen).toBe(true);
    expect(mocks.pickFolder).not.toHaveBeenCalled();
  });
});
