import { describe, expect, it } from "vitest";
import type { CdpConnection, CdpEventListener } from "./cdp.js";
import { CREATED_BY } from "./grammar.js";
import {
  BrowserSessionError,
  createSessionManager,
  type FrameSink,
  type SessionManager,
  type SessionManagerDeps,
} from "./sessions.js";

/**
 * The isolation contract, at the seam where it is decided: every thread gets
 * its own CDP browser context (its own cookie jar) and its own page, and every
 * command a thread issues carries that page's session id and no other. A shared
 * context, or a session id routed to the wrong page, is exactly how one agent's
 * login ends up in another agent's browser — and neither is visible from
 * outside the manager.
 *
 * The fake browser records every CDP call, so "A's input never reached B's
 * page" is an assertion about what went on the wire.
 */

interface RecordedCall {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId: string | undefined;
}

interface FakeChrome {
  readonly connection: CdpConnection;
  emit(method: string, params: unknown, sessionId?: string): void;
  callsTo(method: string): RecordedCall[];
}

function createFakeChrome(): FakeChrome {
  const calls: RecordedCall[] = [];
  const listeners = new Map<string, Set<CdpEventListener>>();
  let contexts = 0;
  let targets = 0;

  function emit(method: string, params: unknown, sessionId?: string): void {
    for (const listener of listeners.get(method) ?? []) {
      listener({ params, sessionId });
    }
  }

  function resultFor(
    method: string,
    params: Record<string, unknown>,
  ): unknown {
    switch (method) {
      case "Target.createBrowserContext":
        return { browserContextId: `ctx-${++contexts}` };
      case "Target.createTarget":
        return { targetId: `target-${++targets}` };
      case "Target.attachToTarget":
        return { sessionId: cdpSessionFor(String(params.targetId)) };
      case "Page.navigate":
        return { frameId: "frame-1" };
      case "Page.captureScreenshot":
        return { data: Buffer.from("shot").toString("base64") };
      case "Runtime.evaluate":
        return {
          result: {
            value: JSON.stringify({
              url: "https://example.test/",
              title: "example",
              text: "body text",
            }),
          },
        };
      default:
        return {};
    }
  }

  function record(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): unknown {
    calls.push({ method, params, sessionId });
    const result = resultFor(method, params);
    // A real page reports it finished loading; without that the manager would
    // sit out its load timeout on every navigate.
    if (method === "Page.navigate") emit("Page.loadEventFired", {}, sessionId);
    return result;
  }

  const connection: CdpConnection = {
    async call(method, params, schema, sessionId) {
      return schema.parse(record(method, params, sessionId));
    },
    async send(method, params = {}, sessionId) {
      record(method, params, sessionId);
    },
    on(method, listener) {
      const set = listeners.get(method) ?? new Set<CdpEventListener>();
      set.add(listener);
      listeners.set(method, set);
      return () => {
        set.delete(listener);
      };
    },
    closed: new Promise<string>(() => {}),
    close() {},
  };

  return {
    connection,
    emit,
    callsTo(method) {
      return calls.filter((call) => call.method === method);
    },
  };
}

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

function createManager(
  chrome: FakeChrome,
  overrides: Partial<SessionManagerDeps> = {},
): SessionManager {
  const manager = createSessionManager({
    log: silentLog,
    viewport: { width: 800, height: 600 },
    jpegQuality: 60,
    idleTimeoutMs: 1_000,
    now: () => 1_000,
    assertThreadExists: async () => {},
    ...overrides,
  });
  manager.attach(chrome.connection);
  return manager;
}

/** The fake attaches a session id derived from the target, so a test can name it. */
function cdpSessionFor(targetId: string): string {
  return `cdp-for-${targetId}`;
}

const noopSink: FrameSink = { frame: () => {}, end: () => {} };

describe("per-thread browser sessions", () => {
  it("gives each thread its own browser context and routes each thread's commands to its own page", async () => {
    const chrome = createFakeChrome();
    const manager = createManager(chrome);

    const targetA = await manager.open({
      threadId: "thread-a",
      url: "https://a.test/",
      createdBy: CREATED_BY.agent,
    });
    const targetB = await manager.open({
      threadId: "thread-b",
      url: "https://b.test/",
      createdBy: CREATED_BY.agent,
    });

    const createdTargets = chrome.callsTo("Target.createTarget");
    expect(chrome.callsTo("Target.createBrowserContext")).toHaveLength(2);
    expect(createdTargets).toHaveLength(2);
    expect(
      new Set(createdTargets.map((call) => call.params.browserContextId)).size,
    ).toBe(2);
    expect(targetA.targetId).not.toBe(targetB.targetId);
    expect(targetA.threadId).toBe("thread-a");
    expect(targetA.createdBy).toBe(CREATED_BY.agent);

    const navigations = chrome.callsTo("Page.navigate");
    const sessionA = navigations.find(
      (call) => call.params.url === "https://a.test/",
    )?.sessionId;
    const sessionB = navigations.find(
      (call) => call.params.url === "https://b.test/",
    )?.sessionId;
    expect(sessionA).toBeDefined();
    expect(sessionB).toBeDefined();
    expect(sessionA).not.toBe(sessionB);
    expect(sessionA).toBe(cdpSessionFor(targetA.targetId));

    await manager.dispatchInput({
      threadId: "thread-a",
      event: { kind: "text", text: "typed into a" },
    });
    const inserts = chrome.callsTo("Input.insertText");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.sessionId).toBe(sessionA);

    await manager.close({ threadId: "thread-a" });
    const disposed = chrome.callsTo("Target.disposeBrowserContext");
    expect(disposed).toHaveLength(1);
    expect(disposed[0]?.params.browserContextId).toBe(
      createdTargets[0]?.params.browserContextId,
    );
    expect(manager.describe("thread-a")).toBeNull();
    expect(manager.describe("thread-b")).not.toBeNull();
  });

  it("creates one context when two viewers race for the same thread", async () => {
    const chrome = createFakeChrome();
    const manager = createManager(chrome);

    const [first, second] = await Promise.all([
      manager.subscribeFrames({
        threadId: "thread-a",
        createdBy: CREATED_BY.cli,
        sink: noopSink,
      }),
      manager.subscribeFrames({
        threadId: "thread-a",
        createdBy: CREATED_BY.cli,
        sink: { frame: () => {}, end: () => {} },
      }),
    ]);

    expect(chrome.callsTo("Target.createBrowserContext")).toHaveLength(1);
    expect(chrome.callsTo("Page.startScreencast")).toHaveLength(1);
    first();
    expect(chrome.callsTo("Page.stopScreencast")).toHaveLength(0);
    second();
    expect(chrome.callsTo("Page.stopScreencast")).toHaveLength(1);
  });

  it("refuses to spend a browser context on a thread bb does not have", async () => {
    const chrome = createFakeChrome();
    const manager = createManager(chrome, {
      assertThreadExists: async (threadId) => {
        if (threadId !== "thread-a") {
          throw new BrowserSessionError(
            "unknown_thread",
            `bb has no thread ${threadId}`,
          );
        }
      },
    });

    await expect(
      manager.open({
        threadId: "not-a-thread",
        url: "https://a.test/",
        createdBy: CREATED_BY.agent,
      }),
    ).rejects.toThrow(/no thread not-a-thread/);
    expect(chrome.callsTo("Target.createBrowserContext")).toHaveLength(0);
  });

  it("reports a close that closed nothing instead of claiming success", async () => {
    const chrome = createFakeChrome();
    const manager = createManager(chrome);

    expect(await manager.close({ threadId: "thread-a" })).toEqual({
      closed: false,
      target: null,
    });
    expect(chrome.callsTo("Target.disposeBrowserContext")).toHaveLength(0);
  });

  it("refuses to open a url the surface will not navigate to", async () => {
    const chrome = createFakeChrome();
    const manager = createManager(chrome);

    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "nonsense"]) {
      await expect(
        manager.open({
          threadId: "thread-a",
          url,
          createdBy: CREATED_BY.agent,
        }),
      ).rejects.toBeInstanceOf(BrowserSessionError);
    }
    expect(chrome.callsTo("Target.createBrowserContext")).toHaveLength(0);
  });

  it("delivers a thread's frames only to that thread's viewers, and forces a first paint", async () => {
    const chrome = createFakeChrome();
    const manager = createManager(chrome);
    const targetA = await manager.open({
      threadId: "thread-a",
      url: "https://a.test/",
      createdBy: CREATED_BY.agent,
    });
    await manager.open({
      threadId: "thread-b",
      url: "https://b.test/",
      createdBy: CREATED_BY.agent,
    });

    const framesA: string[] = [];
    const framesB: string[] = [];
    const unsubscribeA = await manager.subscribeFrames({
      threadId: "thread-a",
      createdBy: CREATED_BY.cli,
      sink: {
        frame: (jpeg) => framesA.push(Buffer.from(jpeg).toString("utf8")),
        end: () => {},
      },
    });
    await manager.subscribeFrames({
      threadId: "thread-b",
      createdBy: CREATED_BY.cli,
      sink: {
        frame: (jpeg) => framesB.push(Buffer.from(jpeg).toString("utf8")),
        end: () => {},
      },
    });

    // A screencast only emits on visual change, so a static page would arrive
    // blank without the forced capture.
    expect(framesA).toEqual(["shot"]);
    expect(framesB).toEqual(["shot"]);
    expect(manager.describe("thread-a")?.visible).toBe(true);

    const cdpSessionA = cdpSessionFor(targetA.targetId);
    chrome.emit(
      "Page.screencastFrame",
      { data: Buffer.from("frame-for-a").toString("base64"), sessionId: 7 },
      cdpSessionA,
    );
    expect(framesA).toEqual(["shot", "frame-for-a"]);
    expect(framesB).toEqual(["shot"]);
    expect(chrome.callsTo("Page.screencastFrameAck")[0]?.sessionId).toBe(
      cdpSessionA,
    );

    unsubscribeA();
    expect(manager.describe("thread-a")?.visible).toBe(false);
    expect(chrome.callsTo("Page.stopScreencast")).toHaveLength(1);
    expect(chrome.callsTo("Page.stopScreencast")[0]?.sessionId).toBe(
      cdpSessionA,
    );
  });

  it("closes an idle session and keeps a watched one", async () => {
    const chrome = createFakeChrome();
    let clock = 1_000;
    const manager = createManager(chrome, { now: () => clock });

    await manager.open({
      threadId: "thread-a",
      url: "https://a.test/",
      createdBy: CREATED_BY.agent,
    });
    await manager.open({
      threadId: "thread-b",
      url: "https://b.test/",
      createdBy: CREATED_BY.agent,
    });
    await manager.subscribeFrames({
      threadId: "thread-b",
      createdBy: CREATED_BY.cli,
      sink: noopSink,
    });

    clock += 60_000;
    await manager.sweepIdle();

    expect(manager.describe("thread-a")).toBeNull();
    expect(manager.describe("thread-b")).not.toBeNull();
  });

  it("forgets a page the browser detached, and says so instead of dispatching into nothing", async () => {
    const chrome = createFakeChrome();
    const manager = createManager(chrome);
    const target = await manager.open({
      threadId: "thread-a",
      url: "https://a.test/",
      createdBy: CREATED_BY.agent,
    });

    const ended: string[] = [];
    await manager.subscribeFrames({
      threadId: "thread-a",
      createdBy: CREATED_BY.cli,
      sink: { frame: () => {}, end: (reason) => ended.push(reason) },
    });

    chrome.emit("Target.detachedFromTarget", {
      sessionId: cdpSessionFor(target.targetId),
    });

    expect(ended).toHaveLength(1);
    expect(manager.describe("thread-a")).toBeNull();
    await expect(
      manager.navigate({ threadId: "thread-a", url: "https://a.test/again" }),
    ).rejects.toThrow(/no open browser session/);
  });

  it("stops serving sessions when the browser goes away", async () => {
    const chrome = createFakeChrome();
    const manager = createManager(chrome);
    await manager.open({
      threadId: "thread-a",
      url: "https://a.test/",
      createdBy: CREATED_BY.agent,
    });

    manager.detach("the browser stopped");

    expect(manager.describe("thread-a")).toBeNull();
    await expect(
      manager.open({
        threadId: "thread-a",
        url: "https://a.test/",
        createdBy: CREATED_BY.agent,
      }),
    ).rejects.toThrow(/not running/);
  });
});
