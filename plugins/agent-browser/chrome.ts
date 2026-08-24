import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * The plugin's own headless Chrome: one process, bound to loopback, with its
 * own profile directory. Never an already-running browser — a shared Chrome
 * would hand every thread the operator's cookies.
 */

const READY_TIMEOUT_MS = 20_000;
const READY_POLL_INTERVAL_MS = 100;
const TERMINATE_GRACE_MS = 3_000;

const versionSchema = z.object({ webSocketDebuggerUrl: z.string().min(1) });

export interface ChromeProcess {
  readonly webSocketDebuggerUrl: string;
  /** Resolves when the process exits, with its exit code or signal. */
  readonly exited: Promise<string>;
  kill(): Promise<void>;
}

export interface LaunchChromeArgs {
  readonly executablePath: string;
  readonly userDataDir: string;
  /** 0 lets Chrome pick a free port; the effective port is read back. */
  readonly remoteDebuggingPort: number;
  readonly log: PluginLogger;
  /** Aborts the wait for readiness, so a shutdown does not have to outlast it. */
  readonly signal: AbortSignal;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Chrome refuses to start on a profile another Chrome still holds. The profile
 * carries nothing this surface needs across restarts (per-thread state lives in
 * throwaway browser contexts), so a stale lock is cleared rather than inherited.
 */
async function clearStaleProfileLocks(userDataDir: string): Promise<void> {
  await Promise.all(
    ["SingletonLock", "SingletonSocket", "SingletonCookie"].map((name) =>
      rm(path.join(userDataDir, name), { force: true }),
    ),
  );
}

/**
 * With an explicit port there is nothing to discover. With port 0 Chrome picks
 * one and writes it to `DevToolsActivePort` in the profile root once it is
 * listening — measured on Chrome 151 headless, where a FIXED port writes no
 * such file, so this is only ever read for port 0.
 */
async function resolvePort(
  userDataDir: string,
  requestedPort: number,
): Promise<number> {
  if (requestedPort !== 0) return requestedPort;
  const raw = await readFile(
    path.join(userDataDir, "DevToolsActivePort"),
    "utf8",
  );
  const port = Number.parseInt(raw.split("\n")[0] ?? "", 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`DevToolsActivePort held ${JSON.stringify(raw)}`);
  }
  return port;
}

export async function launchChrome(
  args: LaunchChromeArgs,
): Promise<ChromeProcess> {
  await mkdir(args.userDataDir, { recursive: true });
  await clearStaleProfileLocks(args.userDataDir);

  const child = spawn(
    args.executablePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${args.remoteDebuggingPort}`,
      `--user-data-dir=${args.userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--hide-crash-restore-bubble",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  let exitDescription: string | null = null;
  const exited = new Promise<string>((resolve) => {
    const settle = (description: string): void => {
      if (exitDescription !== null) return;
      exitDescription = description;
      resolve(description);
    };
    child.once("exit", (code, signal) =>
      settle(signal === null ? `exit code ${code}` : `signal ${signal}`),
    );
    child.once("error", (error) => settle(`spawn failed: ${error.message}`));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString("utf8").trim();
    if (line.length > 0) args.log.debug(`chrome: ${line.slice(0, 500)}`);
  });

  const kill = async (): Promise<void> => {
    if (exitDescription !== null) return;
    child.kill("SIGTERM");
    const outcome = await Promise.race([
      exited,
      sleep(TERMINATE_GRACE_MS).then(() => "timeout" as const),
    ]);
    if (outcome === "timeout") child.kill("SIGKILL");
    await exited;
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    if (args.signal.aborted) {
      await kill();
      throw new Error("Stopped waiting for Chrome: the plugin is shutting down");
    }
    if (exitDescription !== null) {
      throw new Error(`Chrome exited before becoming ready: ${exitDescription}`);
    }
    try {
      const port = await resolvePort(
        args.userDataDir,
        args.remoteDebuggingPort,
      );
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const version = versionSchema.parse(await response.json());
      args.log.info(`Chrome is ready on 127.0.0.1:${port}`);
      return { webSocketDebuggerUrl: version.webSocketDebuggerUrl, exited, kill };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(READY_POLL_INTERVAL_MS);
    }
  }
  await kill();
  throw new Error(
    `Chrome did not answer /json/version within ${READY_TIMEOUT_MS}ms: ${lastError}`,
  );
}
