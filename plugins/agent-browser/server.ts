import { existsSync } from "node:fs";
import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { connectCdp, type CdpConnection } from "./cdp.js";
import { launchChrome } from "./chrome.js";
import {
  agentBrowserRpcContract,
  browserInputEventSchema,
  threadIdSchema,
  type BrowserTarget,
} from "./contract.js";
import {
  BROWSER_VERB,
  CLI_COMMAND,
  CREATED_BY,
  HTTP_ROUTE,
  QUERY_PARAM,
  type CreatedBy,
} from "./grammar.js";
import {
  BrowserSessionError,
  createSessionManager,
  type BrowserSessionErrorCode,
  type FrameSink,
  type SessionManager,
} from "./sessions.js";

const DEFAULT_CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = { width: 1280, height: 800 } as const;
const JPEG_QUALITY = 60;
const IDLE_TIMEOUT_MS = 10 * 60_000;
const IDLE_SWEEP_INTERVAL_MS = 60_000;
const MJPEG_BOUNDARY = "frame";

const STATUS_BY_ERROR_CODE: Record<BrowserSessionErrorCode, number> = {
  browser_unavailable: 503,
  unknown_thread: 404,
  no_session: 404,
  invalid_url: 400,
  navigation_failed: 502,
};

const encoder = new TextEncoder();

function encodeMjpegPart(jpeg: Uint8Array): Uint8Array[] {
  return [
    encoder.encode(
      `--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
    ),
    jpeg,
    encoder.encode("\r\n"),
  ];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function httpStatusOf(error: unknown): number | null {
  if (!(error instanceof Error) || !("status" in error)) return null;
  const { status } = error;
  return typeof status === "number" ? status : null;
}

function missingThreadResponse(): Response {
  return jsonResponse(400, {
    error: "invalid_input",
    message: `${QUERY_PARAM.threadId} is required, e.g. ?${QUERY_PARAM.threadId}=thr_...`,
  });
}

function needsConfiguration(message: string): Error {
  return Object.assign(new Error(message), {
    name: "NeedsConfigurationError",
  });
}

function whenAborted(signal: AbortSignal, reason: string): Promise<string> {
  if (signal.aborted) return Promise.resolve(reason);
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(reason), { once: true });
  });
}

export default async function agentBrowser(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    chromePath: {
      type: "string",
      label: "Chrome executable",
      description:
        "The Chrome binary this plugin launches as its own headless browser. It is never an already-running browser.",
      default: DEFAULT_CHROME_PATH,
    },
    remoteDebuggingPort: {
      type: "string",
      label: "CDP port",
      description:
        "Loopback remote-debugging port for the plugin's own Chrome. 0 lets Chrome pick a free port.",
      default: "39222",
    },
  });

  async function assertThreadExists(threadId: string): Promise<void> {
    try {
      await bb.sdk.threads.get({ threadId });
    } catch (error) {
      if (httpStatusOf(error) === 404) {
        throw new BrowserSessionError(
          "unknown_thread",
          `bb has no thread ${threadId}`,
        );
      }
      throw error;
    }
  }

  const manager: SessionManager = createSessionManager({
    log: bb.log,
    viewport: VIEWPORT,
    jpegQuality: JPEG_QUALITY,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    now: () => Date.now(),
    assertThreadExists,
  });

  /**
   * The plugin's own data directory. The SDK exposes no path onto it, and the
   * plugin's sqlite handle is the one thing that names it.
   * PROPOSE-UPSTREAM: a `bb.storage.dataDir` so a plugin that owns a child
   * process does not have to open a database to learn where it may write.
   */
  function browserProfileDirectory(): string {
    return path.join(path.dirname(bb.storage.database().name), "chrome");
  }

  function errorResponse(error: unknown): Response {
    if (error instanceof BrowserSessionError) {
      return jsonResponse(STATUS_BY_ERROR_CODE[error.code], {
        error: error.code,
        message: error.message,
      });
    }
    bb.log.error(`Browser request failed: ${errorMessage(error)}`);
    return jsonResponse(500, {
      error: "internal_error",
      message: errorMessage(error),
    });
  }

  bb.http.route(
    "GET",
    HTTP_ROUTE.stream,
    async (context) => {
      const requested = threadIdSchema.safeParse(
        context.req.query(QUERY_PARAM.threadId),
      );
      if (!requested.success) return missingThreadResponse();
      const threadId = requested.data;
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let pendingFrame: Uint8Array | null = null;
      let closed = false;
      const sink: FrameSink = {
        frame(jpeg) {
          if (closed) return;
          if (controller === null) {
            // Before the body starts, keep only the newest frame: this is
            // video, and a backlog is staleness, not data.
            pendingFrame = jpeg;
            return;
          }
          if ((controller.desiredSize ?? 0) <= 0) return;
          for (const chunk of encodeMjpegPart(jpeg)) controller.enqueue(chunk);
        },
        end() {
          if (closed) return;
          closed = true;
          controller?.close();
        },
      };

      let unsubscribe: () => void;
      try {
        unsubscribe = await manager.subscribeFrames({
          threadId,
          createdBy: CREATED_BY.cli,
          sink,
        });
      } catch (error) {
        return errorResponse(error);
      }

      // A client that goes away before the body starts would otherwise leave
      // its sink registered forever, holding the session `visible` and out of
      // reach of the idle sweep.
      context.req.raw.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          unsubscribe();
        },
        { once: true },
      );

      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;
          const first = pendingFrame;
          pendingFrame = null;
          if (first !== null) {
            for (const chunk of encodeMjpegPart(first)) {
              streamController.enqueue(chunk);
            }
          }
          if (closed) streamController.close();
        },
        cancel() {
          closed = true;
          unsubscribe();
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
          "cache-control": "no-cache, no-transform",
        },
      });
    },
    { auth: "local" },
  );

  bb.http.route(
    "POST",
    HTTP_ROUTE.input,
    async (context) => {
      const requested = threadIdSchema.safeParse(
        context.req.query(QUERY_PARAM.threadId),
      );
      if (!requested.success) return missingThreadResponse();
      const threadId = requested.data;
      const body: unknown = await context.req.json().catch(() => null);
      const event = browserInputEventSchema.safeParse(body);
      if (!event.success) {
        return jsonResponse(400, {
          error: "invalid_input",
          message: "Unrecognized browser input event",
          issues: event.error.issues.map(({ message, path: at }) => ({
            message,
            path: at,
          })),
        });
      }
      try {
        await manager.dispatchInput({ threadId, event: event.data });
      } catch (error) {
        return errorResponse(error);
      }
      return jsonResponse(200, { dispatched: event.data.kind });
    },
    { auth: "local" },
  );

  // Every rpc call is the operator: rpc handlers get no thread context, so the
  // agent-facing path is the CLI below, where bb forwards the caller's thread.
  bb.rpc.register(agentBrowserRpcContract, {
    [BROWSER_VERB.open]: ({ threadId, url }) =>
      manager.open({ threadId, url, createdBy: CREATED_BY.cli }),
    [BROWSER_VERB.navigate]: ({ threadId, url }) =>
      manager.navigate({ threadId, url }),
    [BROWSER_VERB.snapshot]: ({ threadId }) => manager.snapshot({ threadId }),
    [BROWSER_VERB.close]: ({ threadId }) => manager.close({ threadId }),
  });

  function describeTarget(target: BrowserTarget): string {
    return `${target.targetId} thread=${target.threadId} createdBy=${target.createdBy} visible=${target.visible}`;
  }

  bb.cli.register({
    name: CLI_COMMAND,
    summary: "Drive this thread's own isolated browser session",
    commands: [
      {
        name: BROWSER_VERB.open,
        summary: "Open this thread's browser page on a url",
        usage: `bb ${CLI_COMMAND} open <url> [--thread <id>] [--json]`,
      },
      {
        name: BROWSER_VERB.navigate,
        summary: "Load a url in a page this thread already has open",
        usage: `bb ${CLI_COMMAND} navigate <url> [--thread <id>] [--json]`,
      },
      {
        name: BROWSER_VERB.snapshot,
        summary: "Print the page's url, title and visible text",
        usage: `bb ${CLI_COMMAND} snapshot [--thread <id>] [--json]`,
      },
      {
        name: BROWSER_VERB.close,
        summary: "Close this thread's browser session and its isolated context",
        usage: `bb ${CLI_COMMAND} close [--thread <id>] [--json]`,
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const rest = argv.filter((argument) => argument !== "--json");
      const threadFlagIndex = rest.indexOf("--thread");
      let explicitThreadId: string | undefined;
      if (threadFlagIndex !== -1) {
        explicitThreadId = rest[threadFlagIndex + 1];
        if (explicitThreadId === undefined) {
          return { exitCode: 1, stderr: "--thread needs a thread id" };
        }
        rest.splice(threadFlagIndex, 2);
      }
      const threadId = explicitThreadId ?? ctx.threadId;
      if (threadId === undefined) {
        return {
          exitCode: 1,
          stderr: `bb ${CLI_COMMAND} needs a thread: run it inside one or pass --thread <id>`,
        };
      }
      // A caller naming someone else's thread is the operator; a caller bb
      // handed a thread context to is that thread's agent.
      const createdBy: CreatedBy =
        explicitThreadId === undefined ? CREATED_BY.agent : CREATED_BY.cli;
      const [verb, ...args] = rest;

      try {
        if (verb === BROWSER_VERB.open || verb === BROWSER_VERB.navigate) {
          const url = args[0];
          if (url === undefined || args.length > 1) {
            return {
              exitCode: 1,
              stderr: `Usage: bb ${CLI_COMMAND} ${verb} <url> [--thread <id>] [--json]`,
            };
          }
          const target =
            verb === BROWSER_VERB.open
              ? await manager.open({ threadId, url, createdBy })
              : await manager.navigate({ threadId, url });
          return {
            exitCode: 0,
            stdout: json ? JSON.stringify(target) : describeTarget(target),
          };
        }
        if (verb === BROWSER_VERB.snapshot && args.length === 0) {
          const snapshot = await manager.snapshot({ threadId });
          return {
            exitCode: 0,
            stdout: json
              ? JSON.stringify(snapshot)
              : `${snapshot.url}\n${snapshot.title}\n\n${snapshot.text}`,
          };
        }
        if (verb === BROWSER_VERB.close && args.length === 0) {
          const result = await manager.close({ threadId });
          return {
            exitCode: 0,
            stdout: json
              ? JSON.stringify(result)
              : result.closed
                ? `Closed ${result.target?.targetId}`
                : `Thread ${threadId} had no open browser session`,
          };
        }
      } catch (error) {
        return { exitCode: 1, stderr: errorMessage(error) };
      }
      return {
        exitCode: 1,
        stderr: `Usage: bb ${CLI_COMMAND} <${Object.values(BROWSER_VERB).join("|")}> [arguments] [--thread <id>] [--json]`,
      };
    },
  });

  // A torn-down thread must not leave a browser context behind: an orphaned
  // context keeps its cookies, its page and its memory for the life of the
  // process.
  for (const event of ["thread.deleted", "thread.archived"] as const) {
    bb.events.on(event, ({ thread }) => {
      void manager.close({ threadId: thread.id }).catch((error: unknown) => {
        bb.log.warn(
          `Could not close the browser session for thread ${thread.id}: ${errorMessage(error)}`,
        );
      });
    });
  }

  const idleSweep = setInterval(() => {
    void manager.sweepIdle().catch((error: unknown) => {
      bb.log.warn(`Idle browser sweep failed: ${errorMessage(error)}`);
    });
  }, IDLE_SWEEP_INTERVAL_MS);
  bb.onDispose(() => {
    clearInterval(idleSweep);
  });

  bb.background.service("chrome", {
    async start(signal) {
      const values = await settings.get();
      if (!existsSync(values.chromePath)) {
        throw needsConfiguration(
          `No Chrome executable at ${values.chromePath}. Set the chromePath setting for this plugin.`,
        );
      }
      const port = Number.parseInt(values.remoteDebuggingPort, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw needsConfiguration(
          `remoteDebuggingPort must be a port number, not "${values.remoteDebuggingPort}"`,
        );
      }

      let chrome;
      try {
        chrome = await launchChrome({
          executablePath: values.chromePath,
          userDataDir: browserProfileDirectory(),
          remoteDebuggingPort: port,
          log: bb.log,
          signal,
        });
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
      let connection: CdpConnection | null = null;
      try {
        connection = await connectCdp(chrome.webSocketDebuggerUrl);
        manager.attach(connection);
        const reason = await Promise.race([
          whenAborted(signal, "the plugin is shutting down"),
          chrome.exited.then((description) => `Chrome exited: ${description}`),
          connection.closed.then((why) => `the CDP connection closed: ${why}`),
        ]);
        if (!signal.aborted) {
          // Restarting the service is the recovery: a new Chrome, and every
          // thread's session recreated on its next request.
          throw new Error(`The plugin's browser stopped because ${reason}`);
        }
      } finally {
        manager.detach("the plugin's browser stopped");
        connection?.close();
        await chrome.kill();
      }
    },
  });
}
