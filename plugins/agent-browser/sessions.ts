import type { PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { CdpConnection } from "./cdp.js";
import {
  SNAPSHOT_TEXT_MAX_LENGTH,
  type BrowserInputEvent,
  type BrowserSnapshot,
  type BrowserTarget,
} from "./contract.js";
import { INPUT_KIND, type CreatedBy } from "./grammar.js";

/**
 * One isolated browser session per THREAD.
 *
 * A thread's session is its own CDP browser context (`Target.createBrowserContext`
 * — incognito-like, with its own cookie jar and storage) holding exactly one
 * page. Isolation is the point: two agents that log into the same site must not
 * see each other's credentials, so nothing is ever shared between threads but
 * the browser process itself.
 */

/** CDP results are an external boundary; each call parses the shape it reads. */
const createBrowserContextResultSchema = z.object({
  browserContextId: z.string().min(1),
});
const createTargetResultSchema = z.object({ targetId: z.string().min(1) });
const attachToTargetResultSchema = z.object({ sessionId: z.string().min(1) });
const captureScreenshotResultSchema = z.object({ data: z.string().min(1) });
const navigateResultSchema = z.object({
  frameId: z.string(),
  errorText: z.string().optional(),
});
const evaluateResultSchema = z.object({
  result: z.object({ value: z.string().optional() }),
  exceptionDetails: z.object({ text: z.string() }).optional(),
});
const screencastFrameEventSchema = z.object({
  data: z.string(),
  sessionId: z.number(),
});
const detachedEventSchema = z.object({ sessionId: z.string() });
const pageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
});

const LOAD_TIMEOUT_MS = 15_000;
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

export type BrowserSessionErrorCode =
  | "browser_unavailable"
  | "unknown_thread"
  | "no_session"
  | "invalid_url"
  | "navigation_failed";

export class BrowserSessionError extends Error {
  constructor(
    readonly code: BrowserSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BrowserSessionError";
  }
}

export interface FrameSink {
  frame(jpeg: Uint8Array): void;
  end(reason: string): void;
}

export interface SessionManagerDeps {
  readonly log: PluginLogger;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly jpegQuality: number;
  readonly idleTimeoutMs: number;
  readonly now: () => number;
  /**
   * Rejects with `unknown_thread` unless bb knows this thread. Sessions are
   * created by a request naming a thread id, so without this an unknown id
   * would spend a browser context.
   */
  readonly assertThreadExists: (threadId: string) => Promise<void>;
}

export interface SessionManager {
  attach(connection: CdpConnection): void;
  detach(reason: string): void;
  open(args: {
    threadId: string;
    url: string;
    createdBy: CreatedBy;
  }): Promise<BrowserTarget>;
  navigate(args: { threadId: string; url: string }): Promise<BrowserTarget>;
  snapshot(args: { threadId: string }): Promise<BrowserSnapshot>;
  close(args: { threadId: string }): Promise<{
    closed: boolean;
    target: BrowserTarget | null;
  }>;
  describe(threadId: string): BrowserTarget | null;
  subscribeFrames(args: {
    threadId: string;
    createdBy: CreatedBy;
    sink: FrameSink;
  }): Promise<() => void>;
  dispatchInput(args: {
    threadId: string;
    event: BrowserInputEvent;
  }): Promise<void>;
  sweepIdle(): Promise<void>;
}

interface Session {
  readonly threadId: string;
  readonly browserContextId: string;
  readonly targetId: string;
  readonly cdpSessionId: string;
  readonly createdBy: CreatedBy;
  readonly createdAt: number;
  lastUsedAt: number;
  readonly sinks: Set<FrameSink>;
  screencasting: boolean;
}

function assertNavigableUrl(url: string): string {
  // Convergence note: bb's desktop surface gates urls the same way in
  // apps/desktop/src/desktop-browser-policy.ts (isAllowedBrowserUrl). That
  // module is desktop-only today, so the rule is restated here rather than
  // imported across the app boundary.
  if (url === "about:blank") return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BrowserSessionError("invalid_url", `Not a url: ${url}`);
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new BrowserSessionError(
      "invalid_url",
      `Only http and https urls can be opened, not ${parsed.protocol}`,
    );
  }
  return parsed.toString();
}

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  const sessions = new Map<string, Session>();
  const sessionsByCdpId = new Map<string, Session>();
  const creating = new Map<string, Promise<Session>>();
  let connection: CdpConnection | null = null;
  let unsubscribeEvents: Array<() => void> = [];

  function requireConnection(): CdpConnection {
    if (connection === null) {
      throw new BrowserSessionError(
        "browser_unavailable",
        "The plugin's browser is not running yet",
      );
    }
    return connection;
  }

  function touch(session: Session): void {
    session.lastUsedAt = deps.now();
  }

  function describeSession(session: Session): BrowserTarget {
    return {
      targetId: session.targetId,
      threadId: session.threadId,
      createdBy: session.createdBy,
      visible: session.sinks.size > 0,
      createdAt: new Date(session.createdAt).toISOString(),
      lastUsedAt: new Date(session.lastUsedAt).toISOString(),
    };
  }

  function forget(session: Session, reason: string): void {
    sessions.delete(session.threadId);
    sessionsByCdpId.delete(session.cdpSessionId);
    for (const sink of session.sinks) sink.end(reason);
    session.sinks.clear();
  }

  function onScreencastFrame({
    params,
    sessionId,
  }: {
    params: unknown;
    sessionId: string | undefined;
  }): void {
    if (sessionId === undefined) return;
    const session = sessionsByCdpId.get(sessionId);
    if (!session) return;
    const parsed = screencastFrameEventSchema.safeParse(params);
    if (!parsed.success) return;
    // Chrome stops emitting until the frame is acknowledged, so ack even when
    // the last viewer just left.
    void connection
      ?.send(
        "Page.screencastFrameAck",
        { sessionId: parsed.data.sessionId },
        session.cdpSessionId,
      )
      .catch(() => {});
    if (session.sinks.size === 0) return;
    const jpeg = Buffer.from(parsed.data.data, "base64");
    for (const sink of session.sinks) sink.frame(jpeg);
  }

  function onDetachedFromTarget({ params }: { params: unknown }): void {
    const parsed = detachedEventSchema.safeParse(params);
    if (!parsed.success) return;
    const session = sessionsByCdpId.get(parsed.data.sessionId);
    if (!session) return;
    deps.log.warn(
      `Browser session for thread ${session.threadId} detached; it will be recreated on demand`,
    );
    forget(session, "the browser page went away");
  }

  async function createSession(
    threadId: string,
    createdBy: CreatedBy,
  ): Promise<Session> {
    await deps.assertThreadExists(threadId);
    const cdp = requireConnection();
    const { browserContextId } = await cdp.call(
      "Target.createBrowserContext",
      { disposeOnDetach: false },
      createBrowserContextResultSchema,
    );
    try {
      const { targetId } = await cdp.call(
        "Target.createTarget",
        { url: "about:blank", browserContextId },
        createTargetResultSchema,
      );
      const { sessionId } = await cdp.call(
        "Target.attachToTarget",
        { targetId, flatten: true },
        attachToTargetResultSchema,
      );
      await cdp.send("Page.enable", {}, sessionId);
      // The liveness fix: a backgrounded headless target throttles
      // requestAnimationFrame to 0fps, which freezes the screencast because
      // frames are only emitted on visual change.
      await cdp.send(
        "Emulation.setFocusEmulationEnabled",
        { enabled: true },
        sessionId,
      );
      await cdp.send(
        "Page.setWebLifecycleState",
        { state: "active" },
        sessionId,
      );
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: deps.viewport.width,
          height: deps.viewport.height,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId,
      );
      const now = deps.now();
      const session: Session = {
        threadId,
        browserContextId,
        targetId,
        cdpSessionId: sessionId,
        createdBy,
        createdAt: now,
        lastUsedAt: now,
        sinks: new Set<FrameSink>(),
        screencasting: false,
      };
      sessions.set(threadId, session);
      sessionsByCdpId.set(sessionId, session);
      deps.log.info(
        `Opened an isolated browser session for thread ${threadId} (target ${targetId})`,
      );
      return session;
    } catch (error) {
      await cdp
        .send("Target.disposeBrowserContext", { browserContextId })
        .catch(() => {});
      throw error;
    }
  }

  function ensureSession(
    threadId: string,
    createdBy: CreatedBy,
  ): Promise<Session> {
    const existing = sessions.get(threadId);
    if (existing) {
      touch(existing);
      return Promise.resolve(existing);
    }
    const inflight = creating.get(threadId);
    if (inflight) return inflight;
    const started = createSession(threadId, createdBy).finally(() => {
      creating.delete(threadId);
    });
    creating.set(threadId, started);
    return started;
  }

  function requireSession(threadId: string): Session {
    const session = sessions.get(threadId);
    if (!session) {
      throw new BrowserSessionError(
        "no_session",
        `Thread ${threadId} has no open browser session`,
      );
    }
    touch(session);
    return session;
  }

  async function waitForLoad(session: Session): Promise<void> {
    const cdp = requireConnection();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve();
      }, LOAD_TIMEOUT_MS);
      const unsubscribe = cdp.on("Page.loadEventFired", ({ sessionId }) => {
        if (sessionId !== session.cdpSessionId) return;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      });
    });
  }

  async function navigateSession(session: Session, url: string): Promise<void> {
    const cdp = requireConnection();
    const target = assertNavigableUrl(url);
    const loaded = waitForLoad(session);
    const result = await cdp.call(
      "Page.navigate",
      { url: target },
      navigateResultSchema,
      session.cdpSessionId,
    );
    if (result.errorText !== undefined) {
      throw new BrowserSessionError(
        "navigation_failed",
        `Could not load ${target}: ${result.errorText}`,
      );
    }
    await loaded;
    touch(session);
  }

  async function captureFrame(session: Session): Promise<Uint8Array> {
    const cdp = requireConnection();
    const { data } = await cdp.call(
      "Page.captureScreenshot",
      { format: "jpeg", quality: deps.jpegQuality },
      captureScreenshotResultSchema,
      session.cdpSessionId,
    );
    return Buffer.from(data, "base64");
  }

  async function disposeSession(session: Session): Promise<void> {
    forget(session, "the browser session was closed");
    const cdp = connection;
    if (!cdp) return;
    if (session.screencasting) {
      await cdp
        .send("Page.stopScreencast", {}, session.cdpSessionId)
        .catch(() => {});
    }
    await cdp
      .send("Target.disposeBrowserContext", {
        browserContextId: session.browserContextId,
      })
      .catch((error: unknown) => {
        deps.log.warn(
          `Could not dispose the browser context for thread ${session.threadId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  return {
    attach(next) {
      connection = next;
      unsubscribeEvents = [
        next.on("Page.screencastFrame", onScreencastFrame),
        next.on("Target.detachedFromTarget", onDetachedFromTarget),
      ];
    },

    detach(reason) {
      for (const unsubscribe of unsubscribeEvents) unsubscribe();
      unsubscribeEvents = [];
      connection = null;
      for (const session of [...sessions.values()]) forget(session, reason);
      sessions.clear();
      sessionsByCdpId.clear();
    },

    async open({ threadId, url, createdBy }) {
      const target = assertNavigableUrl(url);
      const session = await ensureSession(threadId, createdBy);
      await navigateSession(session, target);
      return describeSession(session);
    },

    async navigate({ threadId, url }) {
      const session = requireSession(threadId);
      await navigateSession(session, url);
      return describeSession(session);
    },

    async snapshot({ threadId }) {
      const session = requireSession(threadId);
      const cdp = requireConnection();
      const evaluated = await cdp.call(
        "Runtime.evaluate",
        {
          expression: `JSON.stringify({url: location.href, title: document.title, text: (document.body ? document.body.innerText : "").slice(0, ${SNAPSHOT_TEXT_MAX_LENGTH})})`,
          returnByValue: true,
        },
        evaluateResultSchema,
        session.cdpSessionId,
      );
      if (evaluated.exceptionDetails || evaluated.result.value === undefined) {
        throw new BrowserSessionError(
          "navigation_failed",
          `Could not read the page for thread ${threadId}: ${
            evaluated.exceptionDetails?.text ?? "no value returned"
          }`,
        );
      }
      const page = pageSnapshotSchema.parse(JSON.parse(evaluated.result.value));
      return { target: describeSession(session), ...page };
    },

    async close({ threadId }) {
      const session = sessions.get(threadId);
      if (!session) return { closed: false, target: null };
      const target = describeSession(session);
      await disposeSession(session);
      return { closed: true, target };
    },

    describe(threadId) {
      const session = sessions.get(threadId);
      return session ? describeSession(session) : null;
    },

    async subscribeFrames({ threadId, createdBy, sink }) {
      const session = await ensureSession(threadId, createdBy);
      const cdp = requireConnection();
      session.sinks.add(sink);
      try {
        if (!session.screencasting) {
          // Claimed before the await, so two viewers arriving together cannot
          // both start the same screencast.
          session.screencasting = true;
          try {
            await cdp.send(
              "Page.startScreencast",
              {
                format: "jpeg",
                quality: deps.jpegQuality,
                maxWidth: deps.viewport.width,
                maxHeight: deps.viewport.height,
                everyNthFrame: 1,
              },
              session.cdpSessionId,
            );
          } catch (error) {
            session.screencasting = false;
            throw error;
          }
        }
        // A screencast only emits on visual change, so a static page would
        // stream nothing at all until something moved. One capture makes the
        // first frame the page as it stands.
        sink.frame(await captureFrame(session));
      } catch (error) {
        session.sinks.delete(sink);
        throw error;
      }
      return () => {
        session.sinks.delete(sink);
        if (session.sinks.size > 0 || !session.screencasting) return;
        session.screencasting = false;
        void connection
          ?.send("Page.stopScreencast", {}, session.cdpSessionId)
          .catch(() => {});
      };
    },

    async dispatchInput({ threadId, event }) {
      const session = requireSession(threadId);
      const cdp = requireConnection();
      if (event.kind === INPUT_KIND.text) {
        await cdp.send(
          "Input.insertText",
          { text: event.text },
          session.cdpSessionId,
        );
        return;
      }
      if (event.kind === INPUT_KIND.mouse) {
        await cdp.send(
          "Input.dispatchMouseEvent",
          {
            type: event.type,
            x: event.x,
            y: event.y,
            button: event.button,
            clickCount: event.clickCount,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            modifiers: event.modifiers,
          },
          session.cdpSessionId,
        );
        return;
      }
      await cdp.send(
        "Input.dispatchKeyEvent",
        {
          type: event.type,
          key: event.key,
          code: event.code,
          text: event.text,
          windowsVirtualKeyCode: event.windowsVirtualKeyCode,
          modifiers: event.modifiers,
        },
        session.cdpSessionId,
      );
    },

    async sweepIdle() {
      const cutoff = deps.now() - deps.idleTimeoutMs;
      for (const session of [...sessions.values()]) {
        if (session.sinks.size > 0 || session.lastUsedAt > cutoff) continue;
        deps.log.info(
          `Closing the idle browser session for thread ${session.threadId}`,
        );
        await disposeSession(session);
      }
    },
  };
}
