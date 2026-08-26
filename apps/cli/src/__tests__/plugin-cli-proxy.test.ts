import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

import { registerEnvironmentCommands } from "../commands/environment.js";
import { registerGuideCommand } from "../commands/guide.js";
import { registerManagerCommands } from "../commands/manager.js";
import { registerPluginCommands } from "../commands/plugin.js";
import { registerProjectCommands } from "../commands/project.js";
import { registerProviderCommands } from "../commands/provider.js";
import { registerSkillCommands } from "../commands/skill.js";
import { registerStatusCommand } from "../commands/status.js";
import { registerThemeCommands } from "../commands/theme.js";
import { registerThreadCommands } from "../commands/thread/index.js";
import {
  fetchPluginCliContributions,
  findDisabledPluginForCommand,
  findPluginCliCommand,
  pluginProxyCandidate,
  runPluginCliCommand,
  type PluginCliContributionEntry,
} from "../plugin-cli-proxy.js";

// Mirror of RESERVED_BB_CLI_COMMANDS in
// apps/server/src/services/plugins/plugin-api.ts — the server rejects plugin
// CLI commands shadowing core bb commands. Update both together.
const RESERVED_BB_CLI_COMMANDS = [
  "environment",
  "guide",
  "help",
  "manager",
  "plugin",
  "project",
  "provider",
  "skill",
  "status",
  "theme",
  "thread",
];

function buildProgram(): Command {
  const program = new Command();
  const getUrl = () => "http://localhost";
  registerStatusCommand(program, getUrl);
  registerProjectCommands(program, getUrl);
  registerProviderCommands(program, getUrl);
  registerManagerCommands(program, getUrl);
  registerThreadCommands(program, getUrl);
  registerEnvironmentCommands(program, getUrl);
  registerThemeCommands(program, getUrl);
  registerPluginCommands(program, getUrl);
  registerSkillCommands(program, getUrl, () => ({ serverUrl: getUrl() }));
  registerGuideCommand(program);
  return program;
}

function topLevelCommandNames(program: Command): string[] {
  return program.commands.flatMap((command) => [
    command.name(),
    ...command.aliases(),
  ]);
}

describe("reserved bb CLI command names", () => {
  it("every core top-level command is on the server's reserved list", () => {
    const names = topLevelCommandNames(buildProgram());
    const reserved = new Set(RESERVED_BB_CLI_COMMANDS);
    for (const name of names) {
      expect(
        reserved,
        `"${name}" is missing from RESERVED_BB_CLI_COMMANDS`,
      ).toContain(name);
    }
  });

  it("the reserved list carries no stale entries", () => {
    const names = new Set(topLevelCommandNames(buildProgram()));
    names.add("help"); // commander built-in
    for (const reserved of RESERVED_BB_CLI_COMMANDS) {
      expect(
        names,
        `"${reserved}" is reserved but not a core command`,
      ).toContain(reserved);
    }
  });
});

describe("pluginProxyCandidate", () => {
  const known = new Set(["thread", "plugin", "help"]);

  it("returns unknown command names", () => {
    expect(pluginProxyCandidate("linear", known)).toBe("linear");
  });

  it("proxies the builtin plugin commands the kernel no longer owns", () => {
    // `automation` and `connect` moved into builtin plugins: they must not
    // be reserved, and the real program must not register them, so the
    // proxy resolves them against the running server.
    const names = new Set(topLevelCommandNames(buildProgram()));
    names.add("help");
    for (const moved of ["automation", "connect"]) {
      expect(RESERVED_BB_CLI_COMMANDS).not.toContain(moved);
      expect(pluginProxyCandidate(moved, names)).toBe(moved);
    }
  });

  it("never proxies flags, empty args, or core commands", () => {
    expect(pluginProxyCandidate(undefined, known)).toBeNull();
    expect(pluginProxyCandidate("", known)).toBeNull();
    expect(pluginProxyCandidate("--version", known)).toBeNull();
    expect(pluginProxyCandidate("-h", known)).toBeNull();
    expect(pluginProxyCandidate("thread", known)).toBeNull();
    expect(pluginProxyCandidate("help", known)).toBeNull();
  });
});

/** A fetch failure the way Node's real fetch throws it: a TypeError wrapping the errno error. */
function connectionError(code: string, message: string): TypeError {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(new Error(message), {
    code,
  });
  return err;
}

describe("fetchPluginCliContributions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports cause \"refused\" for a connection refusal, with no retry", async () => {
    const fetchMock = vi.fn(async () => {
      throw connectionError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:3000");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPluginCliContributions("http://localhost"),
    ).resolves.toEqual({
      outcome: "unreachable",
      cause: "refused",
      detail: "connect ECONNREFUSED 127.0.0.1:3000",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports cause \"no-address\" for a DNS resolution failure, with no retry", async () => {
    const fetchMock = vi.fn(async () => {
      throw connectionError("ENOTFOUND", "getaddrinfo ENOTFOUND bb.invalid");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPluginCliContributions("http://bb.invalid"),
    ).resolves.toEqual({
      outcome: "unreachable",
      cause: "no-address",
      detail: "getaddrinfo ENOTFOUND bb.invalid",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports cause \"no-address\" for a malformed base URL, with no retry", async () => {
    const fetchMock = vi.fn(async () => {
      throw connectionError("ERR_INVALID_URL", "Invalid URL");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPluginCliContributions("not a url"),
    ).resolves.toEqual({
      outcome: "unreachable",
      cause: "no-address",
      detail: "Invalid URL",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports cause \"unknown\" for an unrecognized error shape (e.g. ECONNRESET), with no retry", async () => {
    const fetchMock = vi.fn(async () => {
      throw connectionError("ECONNRESET", "socket hang up");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPluginCliContributions("http://localhost"),
    ).resolves.toEqual({
      outcome: "unreachable",
      cause: "unknown",
      detail: "socket hang up",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports cause \"unknown\" for a bare error with no name/cause/code, with no retry", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("something broke");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPluginCliContributions("http://localhost"),
    ).resolves.toEqual({
      outcome: "unreachable",
      cause: "unknown",
      detail: "something broke",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once, at 2x the timeout, and succeeds if the retry answers", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new DOMException("signal timed out", "TimeoutError");
      })
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ cliCommands: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPluginCliContributions("http://localhost", 100),
    ).resolves.toEqual({ outcome: "ok", contributions: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Assert the actual timeout the retry's AbortSignal was built with, not
    // just the value the result happens to echo back.
    expect(timeoutSpy.mock.calls).toEqual([[100], [200]]);
    timeoutSpy.mockRestore();
  });

  it("reports cause \"timeout\" with both attempts' timeouts when both time out", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPluginCliContributions("http://localhost", 100),
    ).resolves.toEqual({
      outcome: "unreachable",
      cause: "timeout",
      timeoutsMs: [100, 200],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timeoutSpy.mock.calls).toEqual([[100], [200]]);
    timeoutSpy.mockRestore();
  });

  it("old server without the route falls back silently to commander's error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    await expect(
      fetchPluginCliContributions("http://localhost"),
    ).resolves.toEqual({
      outcome: "invalid",
    });
  });

  it("returns validated contribution entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              cliCommands: [
                {
                  pluginId: "connect",
                  name: "connect",
                  summary: "s",
                  commands: [],
                },
                { bogus: true },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await fetchPluginCliContributions("http://localhost");
    expect(result).toEqual({
      outcome: "ok",
      contributions: [
        { pluginId: "connect", name: "connect", summary: "s", commands: [] },
      ],
    });
  });
});

describe("findDisabledPluginForCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches an installed-but-disabled plugin by id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              plugins: [
                { id: "automations", enabled: true },
                { id: "connect", enabled: false },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      findDisabledPluginForCommand("http://localhost", "connect"),
    ).resolves.toEqual({
      id: "connect",
      enabled: false,
      status: null,
      statusDetail: null,
    });
    // Enabled plugins and unknown names never match.
    await expect(
      findDisabledPluginForCommand("http://localhost", "automations"),
    ).resolves.toBeNull();
    await expect(
      findDisabledPluginForCommand("http://localhost", "linear"),
    ).resolves.toBeNull();
  });

  it("matches a disabled plugin by runtime status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              plugins: [
                {
                  id: "automations",
                  enabled: true,
                  status: "disabled",
                  statusDetail: "plugin failed to load",
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      findDisabledPluginForCommand("http://localhost", "automations"),
    ).resolves.toEqual({
      id: "automations",
      enabled: true,
      status: "disabled",
      statusDetail: "plugin failed to load",
    });
  });

  it("returns null on any fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(
      findDisabledPluginForCommand("http://localhost", "connect"),
    ).resolves.toBeNull();
  });
});

describe("findPluginCliCommand", () => {
  const contributions: PluginCliContributionEntry[] = [
    { pluginId: "linear", name: "linear", summary: "Linear", commands: [] },
    { pluginId: "acme", name: "acme-tools", summary: "Acme", commands: [] },
  ];

  it("matches on the registered command name, not the plugin id", () => {
    expect(findPluginCliCommand(contributions, "acme-tools")?.pluginId).toBe(
      "acme",
    );
    expect(findPluginCliCommand(contributions, "acme")).toBeUndefined();
    expect(findPluginCliCommand(contributions, "linear")?.pluginId).toBe(
      "linear",
    );
  });
});

describe("runPluginCliCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits for output larger than 64 KiB to flush before returning", async () => {
    const stdout = "x".repeat(1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ exitCode: 0, stdout, stderr: "warning" }),
            { status: 200 },
          ),
      ),
    );
    const writes: Array<{ channel: "stdout" | "stderr"; value: string }> = [];
    let pendingWrites = 0;
    const outputStream = (channel: "stdout" | "stderr") => ({
      write(value: string, callback: (error?: Error | null) => void) {
        pendingWrites += 1;
        setTimeout(() => {
          writes.push({ channel, value });
          pendingWrites -= 1;
          callback();
        }, 0);
        return false;
      },
    });

    const exitCode = await runPluginCliCommand(
      "http://localhost",
      "fixture",
      [],
      { stdout: outputStream("stdout"), stderr: outputStream("stderr") },
    );

    expect(exitCode).toBe(0);
    expect(pendingWrites).toBe(0);
    expect(writes).toEqual([
      { channel: "stdout", value: `${stdout}\n` },
      { channel: "stderr", value: "warning\n" },
    ]);
  });
});
