import {
  resolveContextProjectId,
  resolveContextThreadId,
} from "./context-env.js";
import { cliFetch } from "./client.js";

/**
 * Plugin-contributed `bb` subcommands (server design §4.4). The CLI fetches
 * metadata from GET /api/v1/plugins/contributions and proxies invocations to
 * POST /api/v1/plugins/:id/cli — plugin code only ever runs server-side.
 */
export interface PluginCliContributionEntry {
  pluginId: string;
  name: string;
  summary: string;
  commands: Array<{ name: string; summary: string; usage: string }>;
}

const CONTRIBUTIONS_TIMEOUT_MS = 2000;
const TIMEOUT_RETRY_MULTIPLIER = 2;

/** The distinct reasons `fetchPluginCliContributions` can fail to reach bb. */
export type PluginCliUnreachableCause = "timeout" | "refused" | "no-address";

/**
 * Result of asking the server for plugin CLI contributions. "unreachable"
 * (fetch threw) is distinguished from "invalid" (an old server without the
 * route, or a malformed payload) so unknown-command handling can tell the
 * user to start bb instead of printing a misleading "unknown command" for a
 * plugin command that would exist if bb were up.
 *
 * "unreachable" itself carries a `cause` because a slow-to-boot server, a
 * refused connection, and a bad/absent address are different situations that
 * warrant different advice — collapsing them into one message misdiagnoses
 * whichever two weren't the actual cause. `cause: "timeout"` reflects both
 * attempts having timed out (see the retry below); `timeoutsMs` then carries
 * each attempt's timeout for the caller to report.
 */
export type PluginCliContributionsResult =
  | { outcome: "ok"; contributions: PluginCliContributionEntry[] }
  | {
      outcome: "unreachable";
      cause: PluginCliUnreachableCause;
      detail?: string;
      timeoutsMs?: readonly [number, number];
    }
  | { outcome: "invalid" };

function errorName(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : undefined;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function errorMessage(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : undefined;
}

/**
 * Classify a thrown fetch error into the taxonomy above. AbortSignal.timeout
 * rejects with a "TimeoutError" (name-checked rather than instanceof-checked
 * since Node's DOMException doesn't extend Error); Node's fetch wraps a
 * refused/unresolvable connection in a TypeError whose `.cause` carries the
 * underlying errno code.
 */
function classifyUnreachableError(error: unknown): {
  cause: PluginCliUnreachableCause;
  detail?: string;
} {
  const name = errorName(error);
  if (name === "TimeoutError" || name === "AbortError") {
    return { cause: "timeout" };
  }
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  const code = errorCode(cause);
  if (code === "ECONNREFUSED") {
    return { cause: "refused", detail: errorMessage(cause) };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { cause: "no-address", detail: errorMessage(cause) };
  }
  return { cause: "no-address", detail: errorMessage(error) };
}

async function requestPluginCliContributions(
  baseUrl: string,
  timeoutMs: number,
): Promise<Response> {
  return cliFetch(`${baseUrl}/api/v1/plugins/contributions`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Fetch plugin CLI contributions with a short timeout. A timeout gets one
 * retry, more patient than the first attempt, because a booting server
 * answering the second ask looks identical to a dead one on the first —
 * "refused" is never retried, since nothing is listening to answer sooner.
 */
export async function fetchPluginCliContributions(
  baseUrl: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): Promise<PluginCliContributionsResult> {
  let response: Response;
  try {
    response = await requestPluginCliContributions(baseUrl, timeoutMs);
  } catch (error) {
    const classified = classifyUnreachableError(error);
    if (classified.cause !== "timeout") {
      return {
        outcome: "unreachable",
        cause: classified.cause,
        detail: classified.detail,
      };
    }
    const retryTimeoutMs = timeoutMs * TIMEOUT_RETRY_MULTIPLIER;
    try {
      response = await requestPluginCliContributions(baseUrl, retryTimeoutMs);
    } catch (retryError) {
      const retryClassified = classifyUnreachableError(retryError);
      if (retryClassified.cause !== "timeout") {
        return {
          outcome: "unreachable",
          cause: retryClassified.cause,
          detail: retryClassified.detail,
        };
      }
      return {
        outcome: "unreachable",
        cause: "timeout",
        timeoutsMs: [timeoutMs, retryTimeoutMs],
      };
    }
  }
  try {
    if (!response.ok) return { outcome: "invalid" };
    const parsed = (await response.json()) as {
      cliCommands?: unknown;
    } | null;
    const cliCommands = parsed?.cliCommands;
    if (!Array.isArray(cliCommands)) return { outcome: "invalid" };
    return {
      outcome: "ok",
      contributions: cliCommands.filter(
        (entry): entry is PluginCliContributionEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as { pluginId?: unknown }).pluginId === "string" &&
          typeof (entry as { name?: unknown }).name === "string",
      ),
    };
  } catch {
    return { outcome: "invalid" };
  }
}

/**
 * Look up an installed-but-disabled plugin whose id matches the unknown
 * command name (the `bb <id>` convention builtins follow), so `bb connect`
 * with the connect plugin disabled explains itself instead of erroring with
 * "unknown command". Best effort: any failure returns null.
 */
export async function findDisabledPluginForCommand(
  baseUrl: string,
  name: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): Promise<{
  id: string;
  enabled: boolean;
  status: string | null;
  statusDetail: string | null;
} | null> {
  try {
    const response = await cliFetch(`${baseUrl}/api/v1/plugins`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as { plugins?: unknown } | null;
    if (!Array.isArray(parsed?.plugins)) return null;
    const match = parsed.plugins.find(
      (
        entry,
      ): entry is {
        id: string;
        enabled: boolean;
        status?: unknown;
        statusDetail?: unknown;
      } =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { id?: unknown }).id === name &&
        typeof (entry as { enabled?: unknown }).enabled === "boolean" &&
        ((entry as { enabled?: unknown }).enabled === false ||
          (entry as { status?: unknown }).status === "disabled"),
    );
    return match === undefined
      ? null
      : {
          id: match.id,
          enabled: match.enabled,
          status: typeof match.status === "string" ? match.status : null,
          statusDetail:
            typeof match.statusDetail === "string" ? match.statusDetail : null,
        };
  } catch {
    return null;
  }
}

export function findPluginCliCommand(
  contributions: readonly PluginCliContributionEntry[],
  name: string,
): PluginCliContributionEntry | undefined {
  return contributions.find((entry) => entry.name === name);
}

/**
 * The first CLI token is a plugin-proxy candidate only when it looks like a
 * command (not a flag) and no core command claims it. Core commands always
 * win: commander resolved them before this path runs.
 */
export function pluginProxyCandidate(
  firstArg: string | undefined,
  knownCommandNames: ReadonlySet<string>,
): string | null {
  if (firstArg === undefined || firstArg.length === 0) return null;
  if (firstArg.startsWith("-")) return null;
  if (knownCommandNames.has(firstArg)) return null;
  return firstArg;
}

interface PluginCliOutputStream {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
}

interface PluginCliOutputStreams {
  stdout: PluginCliOutputStream;
  stderr: PluginCliOutputStream;
}

async function writePluginCliOutput(
  stream: PluginCliOutputStream,
  value: string,
): Promise<void> {
  if (value.length === 0) return;
  const output = value.endsWith("\n") ? value : `${value}\n`;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.write(output, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

/**
 * Proxy one invocation to the server and mirror its output. Returns the
 * command's exit code after both output streams have flushed. Waiting for the
 * write callbacks is required because callers terminate the CLI process as
 * soon as this promise resolves; an immediate exit can otherwise drop every
 * buffered byte after the platform pipe capacity.
 */
export async function runPluginCliCommand(
  baseUrl: string,
  pluginId: string,
  argv: string[],
  streams: PluginCliOutputStreams = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  const threadId = resolveContextThreadId();
  const projectId = resolveContextProjectId();
  const response = await cliFetch(
    `${baseUrl}/api/v1/plugins/${encodeURIComponent(pluginId)}/cli`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        argv,
        cwd: process.cwd(),
        ...(threadId ? { threadId } : {}),
        ...(projectId ? { projectId } : {}),
      }),
    },
  );
  const result = (await response.json().catch(() => null)) as {
    exitCode?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    error?: unknown;
  } | null;
  if (result === null || typeof result.exitCode !== "number") {
    await writePluginCliOutput(
      streams.stderr,
      typeof result?.error === "string"
        ? result.error
        : `Unexpected response from the plugin CLI endpoint (HTTP ${response.status})`,
    );
    return 1;
  }
  if (typeof result.stdout === "string" && result.stdout.length > 0) {
    await writePluginCliOutput(streams.stdout, result.stdout);
  }
  if (typeof result.stderr === "string" && result.stderr.length > 0) {
    await writePluginCliOutput(streams.stderr, result.stderr);
  }
  return result.exitCode;
}
