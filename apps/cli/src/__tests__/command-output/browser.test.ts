import { describe, expect, it, vi } from "vitest";
import { CREATED_BY } from "@bb/server-contract";
import {
  collectLogLines,
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerBrowserCommands } from "../../commands/browser.js";

function makeBrowserTarget(overrides: Record<string, unknown> = {}) {
  return {
    targetId: "tgt-1",
    threadId: "thr-1",
    createdBy: CREATED_BY.cli,
    visible: true,
    createdAt: "2026-08-27T00:00:00.000Z",
    lastUsedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("bb browser command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerBrowserCommands(program, () => "http://server");

  it("documents the verb set in help", async () => {
    const help = await getHelpOutput(["browser"], register);

    expect(help).toContain("open [options] <url>");
    expect(help).toContain("list");
    expect(help).toContain("navigate [options] <target-id> <url>");
    expect(help).toContain("snapshot [options] <target-id>");
    expect(help).toContain("click [options] <target-id>");
    expect(help).toContain("type [options] <target-id>");
    expect(help).toContain("eval [options] <target-id>");
    expect(help).toContain("close [options] <target-id>");
    expect(help).toContain("--thread <id>");
  });

  it("opens a URL with explicit thread scope", async () => {
    const open = vi.fn(async ({ json }) => ({
      ...makeBrowserTarget(),
      ...json,
    }));
    stubServerApi({ "v1.browser.open.$post": open });

    await runCommand(
      ["browser", "open", "https://example.com", "--thread", "thr-1", "--visible"],
      register,
    );

    expect(open).toHaveBeenCalledWith({
      json: { url: "https://example.com", visible: true },
    });
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "Opened browser target tgt-1",
    );
  });

  it("defaults thread scope from BB_THREAD_ID", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr-env");
    const open = vi.fn(async () => makeBrowserTarget({ threadId: "thr-env" }));
    stubServerApi({ "v1.browser.open.$post": open });

    await runCommand(["browser", "open", "https://example.com"], register);

    expect(open).toHaveBeenCalledWith({
      json: { url: "https://example.com" },
    });
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Thread thr-env (from BB_THREAD_ID)",
    );
  });

  it("lists targets in thread scope", async () => {
    const list = vi.fn(async ({ query }) => ({
      targets: [makeBrowserTarget({ targetId: "tgt-listed" })],
    }));
    stubServerApi({ "v1.browser.list.$get": list });

    await runCommand(["browser", "list", "--thread", "thr-1", "--json"], register);

    expect(list).toHaveBeenCalledWith({ query: { thread: "thr-1" } });
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0])).toEqual({
      targets: [
        expect.objectContaining({ targetId: "tgt-listed", threadId: "thr-1" }),
      ],
    });
  });

  it("navigates a target", async () => {
    const navigate = vi.fn(async ({ json }) =>
      makeBrowserTarget({ targetId: json.targetId }),
    );
    stubServerApi({ "v1.browser.navigate.$post": navigate });

    await runCommand(
      ["browser", "navigate", "tgt-1", "https://example.com/new", "--thread", "thr-1"],
      register,
    );

    expect(navigate).toHaveBeenCalledWith({
      json: { targetId: "tgt-1", url: "https://example.com/new" },
    });
  });

  it("snapshots a target", async () => {
    const snapshot = vi.fn(async ({ json }) => ({
      target: makeBrowserTarget({ targetId: json.targetId }),
      url: "https://example.com",
      title: "Example",
      text: "Hello",
    }));
    stubServerApi({ "v1.browser.snapshot.$post": snapshot });

    await runCommand(["browser", "snapshot", "tgt-1", "--thread", "thr-1"], register);

    expect(snapshot).toHaveBeenCalledWith({
      json: { targetId: "tgt-1" },
    });
    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("https://example.com — Example");
    expect(output).toContain("Hello");
  });

  it("clicks by selector", async () => {
    const click = vi.fn(async ({ json }) =>
      makeBrowserTarget({ targetId: json.targetId }),
    );
    stubServerApi({ "v1.browser.click.$post": click });

    await runCommand(
      [
        "browser",
        "click",
        "tgt-1",
        "--selector",
        "button.submit",
        "--thread",
        "thr-1",
      ],
      register,
    );

    expect(click).toHaveBeenCalledWith({
      json: { targetId: "tgt-1", selector: "button.submit" },
    });
  });

  it("clicks by coordinates", async () => {
    const click = vi.fn(async ({ json }) =>
      makeBrowserTarget({ targetId: json.targetId }),
    );
    stubServerApi({ "v1.browser.click.$post": click });

    await runCommand(
      ["browser", "click", "tgt-1", "--x", "420", "--y", "315", "--thread", "thr-1"],
      register,
    );

    expect(click).toHaveBeenCalledWith({
      json: { targetId: "tgt-1", x: 420, y: 315 },
    });
  });

  it("types into a selector", async () => {
    const type = vi.fn(async ({ json }) =>
      makeBrowserTarget({ targetId: json.targetId }),
    );
    stubServerApi({ "v1.browser.type.$post": type });

    await runCommand(
      [
        "browser",
        "type",
        "tgt-1",
        "--selector",
        "#email",
        "--text",
        "user@example.com",
        "--thread",
        "thr-1",
      ],
      register,
    );

    expect(type).toHaveBeenCalledWith({
      json: {
        targetId: "tgt-1",
        selector: "#email",
        text: "user@example.com",
      },
    });
  });

  it("evaluates a script file", async () => {
    const evalPost = vi.fn(async ({ json }) => ({
      target: makeBrowserTarget({ targetId: json.targetId }),
      result: { ok: true },
    }));
    stubServerApi({ "v1.browser.eval.$post": evalPost });

    await runCommand(
      [
        "browser",
        "eval",
        "tgt-1",
        "--script-file",
        new URL("./browser.test.ts", import.meta.url).pathname,
        "--thread",
        "thr-1",
        "--json",
      ],
      register,
    );

    expect(evalPost).toHaveBeenCalledWith({
      json: {
        targetId: "tgt-1",
        script: expect.stringContaining("bb browser command output"),
      },
    });
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0])).toEqual({
      target: expect.objectContaining({ targetId: "tgt-1" }),
      result: { ok: true },
    });
  });

  it("closes a target", async () => {
    const close = vi.fn(async () => ({
      closed: true,
      target: makeBrowserTarget(),
    }));
    stubServerApi({ "v1.browser.close.$post": close });

    await runCommand(["browser", "close", "tgt-1", "--thread", "thr-1"], register);

    expect(close).toHaveBeenCalledWith({
      json: { targetId: "tgt-1" },
    });
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "Closed browser target tgt-1",
    );
  });
});
