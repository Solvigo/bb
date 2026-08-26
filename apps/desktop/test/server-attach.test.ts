import { describe, expect, it } from "vitest";
import {
  applyEnvAttachServerTarget,
  BB_DESKTOP_ATTACH_URL_ENV,
  formatAttachProbeFailureMessage,
  isAttachOnlyConfigured,
  resolveElectronBuilderAttachEnvironment,
  resolveEnvAttachServerUrl,
} from "../src/server-attach.js";
import {
  createServerTargetStore,
  type ServerTargetFs,
} from "../src/server-target.js";

function createMemoryFs(initial: Record<string, string> = {}): {
  fs: ServerTargetFs;
} {
  const files = new Map(Object.entries(initial));
  return {
    fs: {
      async mkdir() {
        return undefined;
      },
      async readFile(path) {
        const content = files.get(path);
        if (content === undefined) {
          throw new Error(`ENOENT: ${path}`);
        }
        return content;
      },
      async writeFile(path, data) {
        files.set(path, data);
      },
    },
  };
}

describe("resolveEnvAttachServerUrl", () => {
  it("prefers BB_DESKTOP_ATTACH_URL over BB_SERVER_URL and BB_SERVER_PORT", () => {
    expect(
      resolveEnvAttachServerUrl({
        env: {
          [BB_DESKTOP_ATTACH_URL_ENV]: "http://127.0.0.1:21990",
          BB_SERVER_URL: "http://127.0.0.1:1",
          BB_SERVER_PORT: "2",
        },
      }),
    ).toBe("http://127.0.0.1:21990");
  });

  it("falls back to BB_SERVER_URL and BB_SERVER_PORT", () => {
    expect(
      resolveEnvAttachServerUrl({
        env: { BB_SERVER_URL: "http://127.0.0.1:21990/" },
      }),
    ).toBe("http://127.0.0.1:21990");
    expect(
      resolveEnvAttachServerUrl({
        env: { BB_SERVER_PORT: "21990" },
      }),
    ).toBe("http://127.0.0.1:21990");
  });

  it("returns null when no attach URL is configured", () => {
    expect(resolveEnvAttachServerUrl({ env: {} })).toBeNull();
    expect(
      resolveEnvAttachServerUrl({ env: { BB_SERVER_PORT: "not-a-port" } }),
    ).toBeNull();
  });
});

describe("applyEnvAttachServerTarget", () => {
  it("pins the store to the configured attach URL", async () => {
    const { fs } = createMemoryFs();
    const store = createServerTargetStore({ fs, storagePath: "/tmp/t.json" });
    await store.load();
    expect(store.getTarget()).toEqual({ kind: "builtin" });

    await applyEnvAttachServerTarget({
      env: { BB_DESKTOP_ATTACH_URL: "http://127.0.0.1:21990" },
      store,
    });

    expect(store.getTarget()).toEqual({
      kind: "custom",
      url: "http://127.0.0.1:21990",
    });
  });
});

describe("attach-only helpers", () => {
  it("detects attach-only configuration", () => {
    expect(isAttachOnlyConfigured({ env: {} })).toBe(false);
    expect(
      isAttachOnlyConfigured({
        env: { BB_DESKTOP_ATTACH_URL: "http://127.0.0.1:21990" },
      }),
    ).toBe(true);
  });

  it("formats loud attach probe failures", () => {
    expect(
      formatAttachProbeFailureMessage("http://127.0.0.1:21990", {
        kind: "unavailable",
        reason: "connection refused",
        serverUrl: "http://127.0.0.1:21990",
      }),
    ).toContain("will not start a bundled server");
    expect(
      formatAttachProbeFailureMessage("http://127.0.0.1:21990", {
        kind: "incompatible",
        reason: "wrong health payload",
        serverUrl: "http://127.0.0.1:21990",
      }),
    ).toContain("not a compatible bb server");
  });

  it("bakes attach env into electron-builder LSEnvironment", () => {
    expect(
      resolveElectronBuilderAttachEnvironment({
        env: { BB_DESKTOP_ATTACH_URL: "http://127.0.0.1:21990" },
      }),
    ).toEqual({
      BB_DESKTOP_ATTACH_URL: "http://127.0.0.1:21990",
      BB_DESKTOP_AUTO_UPDATE: "0",
      BB_DESKTOP_VERSION_CHECK: "0",
    });
  });
});
