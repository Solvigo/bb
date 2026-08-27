import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { BB_CALLER_THREAD_ID_HEADER } from "@bb/server-contract";
import type { FetchImplementation } from "@bb/sdk/node";
import { action } from "../action.js";
import { cliFetch, createCliTransport } from "../client.js";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
  type ResolvedId,
} from "../context-env.js";
import {
  outputJson,
  printContextLabel,
  type JsonOutputOptions,
} from "./helpers.js";

interface BrowserThreadOptions extends JsonOutputOptions {
  thread?: string;
}

interface BrowserOpenOptions extends BrowserThreadOptions {
  visible?: boolean;
}

interface BrowserClickOptions extends BrowserThreadOptions {
  selector?: string;
  x?: string;
  y?: string;
}

interface BrowserTypeOptions extends BrowserThreadOptions {
  selector: string;
  text: string;
}

interface BrowserEvalOptions extends BrowserThreadOptions {
  scriptFile: string;
}

function createBrowserClient(baseUrl: string, threadId: string) {
  const transport = createCliTransport(baseUrl, {
    fetch: createThreadScopedFetch(threadId),
  });
  return {
    api: transport.api.v1.browser,
    readJson: transport.readJson,
  };
}

function createThreadScopedFetch(threadId: string): FetchImplementation {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(BB_CALLER_THREAD_ID_HEADER, threadId);
    return cliFetch(input, { ...init, headers });
  };
}

function browserThreadQuery(threadId: string): { thread: string } {
  return { thread: threadId };
}

function resolveBrowserThreadId(opts: BrowserThreadOptions): ResolvedId {
  const fromFlag = resolveExplicitIdFlag({
    flagName: "--thread",
    value: opts.thread,
  });
  if (fromFlag) {
    return { id: fromFlag, source: "arg" };
  }
  const fromEnv = resolveContextThreadId();
  if (fromEnv) {
    return { id: fromEnv, source: "env" };
  }
  throw new Error(
    "Missing thread. Pass --thread <id> or set BB_THREAD_ID.",
  );
}

function printBrowserThreadContext(
  resolved: ResolvedId,
  opts: JsonOutputOptions,
): void {
  printContextLabel(resolved, "Thread", "BB_THREAD_ID", opts);
}

function parseCoordinate(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  return parsed;
}

function buildClickPayload(
  targetId: string,
  opts: BrowserClickOptions,
): { targetId: string; selector: string } | {
  targetId: string;
  x: number;
  y: number;
} {
  const hasSelector = opts.selector !== undefined;
  const hasX = opts.x !== undefined;
  const hasY = opts.y !== undefined;
  if (hasSelector && (hasX || hasY)) {
    throw new Error("Provide --selector or --x/--y, not both");
  }
  if (!hasSelector && !(hasX && hasY)) {
    throw new Error("Provide --selector or both --x and --y");
  }
  if (hasSelector) {
    return { targetId, selector: opts.selector as string };
  }
  return {
    targetId,
    x: parseCoordinate(opts.x as string, "--x"),
    y: parseCoordinate(opts.y as string, "--y"),
  };
}

function addBrowserThreadOption(command: Command): Command {
  return command.option(
    "--thread <id>",
    "Thread scope (defaults from BB_THREAD_ID when set)",
  );
}

export function registerBrowserCommands(
  program: Command,
  getUrl: () => string,
): void {
  const browser = program
    .command("browser")
    .description("Drive in-app browser automation in the bb desktop app");

  addBrowserThreadOption(
    browser
      .command("open <url>")
      .description("Open a URL in a new automation-owned browser target")
      .option("--visible", "Open a visible in-panel browser tab")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (url: string, opts: BrowserOpenOptions) => {
      const thread = resolveBrowserThreadId(opts);
      printBrowserThreadContext(thread, opts);
      const { api, readJson } = createBrowserClient(getUrl(), thread.id);
      const target = await readJson(
        api.open.$post({
          json: {
            url,
            ...(opts.visible ? { visible: true } : {}),
          },
        }),
      );
      if (outputJson(opts, target)) return;
      console.log(`Opened browser target ${target.targetId}`);
    }),
  );

  addBrowserThreadOption(
    browser
      .command("list")
      .description("List automation-owned browser targets in thread scope")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: BrowserThreadOptions) => {
      const thread = resolveBrowserThreadId(opts);
      printBrowserThreadContext(thread, opts);
      const { api, readJson } = createBrowserClient(getUrl(), thread.id);
      const result = await readJson(
        api.list.$get({ query: browserThreadQuery(thread.id) }),
      );
      if (outputJson(opts, result)) return;
      if (result.targets.length === 0) {
        console.log("No browser automation targets found");
        return;
      }
      for (const target of result.targets) {
        console.log(
          `${target.targetId}  thread=${target.threadId}  visible=${target.visible}  by=${target.createdBy}`,
        );
      }
    }),
  );

  addBrowserThreadOption(
    browser
      .command("navigate <target-id> <url>")
      .description("Navigate an automation-owned browser target to a URL")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (targetId: string, url: string, opts: BrowserThreadOptions) => {
      const thread = resolveBrowserThreadId(opts);
      printBrowserThreadContext(thread, opts);
      const { api, readJson } = createBrowserClient(getUrl(), thread.id);
      const target = await readJson(
        api.navigate.$post({
          json: { targetId, url },
        }),
      );
      if (outputJson(opts, target)) return;
      console.log(`Navigated browser target ${target.targetId}`);
    }),
  );

  addBrowserThreadOption(
    browser
      .command("snapshot <target-id>")
      .description("Capture page state for an automation-owned browser target")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (targetId: string, opts: BrowserThreadOptions) => {
      const thread = resolveBrowserThreadId(opts);
      printBrowserThreadContext(thread, opts);
      const { api, readJson } = createBrowserClient(getUrl(), thread.id);
      const snapshot = await readJson(
        api.snapshot.$post({
          json: { targetId },
        }),
      );
      if (outputJson(opts, snapshot)) return;
      console.log(`${snapshot.url} — ${snapshot.title}`);
      console.log(snapshot.text);
    }),
  );

  addBrowserThreadOption(
    browser
      .command("click <target-id>")
      .description("Click in an automation-owned browser target")
      .option("--selector <selector>", "DOM selector to click")
      .option("--x <n>", "Viewport X coordinate")
      .option("--y <n>", "Viewport Y coordinate")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (targetId: string, opts: BrowserClickOptions) => {
      const thread = resolveBrowserThreadId(opts);
      printBrowserThreadContext(thread, opts);
      const { api, readJson } = createBrowserClient(getUrl(), thread.id);
      const target = await readJson(
        api.click.$post({
          json: buildClickPayload(targetId, opts),
        }),
      );
      if (outputJson(opts, target)) return;
      console.log(`Clicked browser target ${target.targetId}`);
    }),
  );

  addBrowserThreadOption(
    browser
      .command("type <target-id>")
      .description("Type into an automation-owned browser target")
      .requiredOption("--selector <selector>", "DOM selector to type into")
      .requiredOption("--text <text>", "Text to type")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (targetId: string, opts: BrowserTypeOptions) => {
      const thread = resolveBrowserThreadId(opts);
      printBrowserThreadContext(thread, opts);
      const { api, readJson } = createBrowserClient(getUrl(), thread.id);
      const target = await readJson(
        api.type.$post({
          json: {
            targetId,
            selector: opts.selector,
            text: opts.text,
          },
        }),
      );
      if (outputJson(opts, target)) return;
      console.log(`Typed into browser target ${target.targetId}`);
    }),
  );

  addBrowserThreadOption(
    browser
      .command("eval <target-id>")
      .description("Evaluate a script in an automation-owned browser target")
      .requiredOption(
        "--script-file <path>",
        "JavaScript file to evaluate in the target page",
      )
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (targetId: string, opts: BrowserEvalOptions) => {
      const thread = resolveBrowserThreadId(opts);
      printBrowserThreadContext(thread, opts);
      const script = await readFile(opts.scriptFile, "utf8");
      const { api, readJson } = createBrowserClient(getUrl(), thread.id);
      const result = await readJson(
        api.eval.$post({
          json: { targetId, script },
        }),
      );
      if (outputJson(opts, result)) return;
      console.log(JSON.stringify(result.result, null, 2));
    }),
  );

  addBrowserThreadOption(
    browser
      .command("close <target-id>")
      .description("Close an automation-owned browser target")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (targetId: string, opts: BrowserThreadOptions) => {
      const thread = resolveBrowserThreadId(opts);
      printBrowserThreadContext(thread, opts);
      const { api, readJson } = createBrowserClient(getUrl(), thread.id);
      const result = await readJson(
        api.close.$post({
          json: { targetId },
        }),
      );
      if (outputJson(opts, result)) return;
      if (result.closed) {
        console.log(`Closed browser target ${targetId}`);
      } else {
        console.log(`Browser target ${targetId} was not found`);
      }
    }),
  );
}
