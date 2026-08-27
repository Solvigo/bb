import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_VERB, type DesktopAutomationCommandMessage } from "@bb/server-contract";
import type { BbDesktopAutomationApi, BbDesktopInfo } from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  handleAutomationCommand,
  type DesktopAutomationCommandHandlers,
} from "./desktop-automation-channel";

const TEST_DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function createAutomationApi(
  overrides: Partial<BbDesktopAutomationApi> = {},
): BbDesktopAutomationApi {
  return {
    registerTarget: vi.fn(async () => undefined),
    unregisterTarget: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => ({ url: "", title: "", text: "" })),
    click: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    eval: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createHandlers(
  overrides: Partial<DesktopAutomationCommandHandlers> = {},
): DesktopAutomationCommandHandlers {
  return {
    onCloseTab: vi.fn(),
    onOpenTab: vi.fn(async () => ({ tabId: "browser:tab-1" })),
    onStopTarget: vi.fn(async () => undefined),
    resolveTabId: vi.fn(() => null),
    ...overrides,
  };
}

function createFakeSocket() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
  };
}

function openCommand(
  overrides: Partial<DesktopAutomationCommandMessage> = {},
): DesktopAutomationCommandMessage {
  return {
    type: "command",
    requestId: "req-1",
    verb: BROWSER_VERB.open,
    threadId: "thr_test",
    targetId: "tgt_test",
    payload: { targetId: "tgt_test", url: "https://example.com", visible: true },
    ...overrides,
  } as DesktopAutomationCommandMessage;
}

describe("handleAutomationCommand open", () => {
  afterEach(() => {
    delete window.bbDesktop;
    vi.restoreAllMocks();
  });

  it("responds once the tab is opened and registered, without a follow-up navigate", async () => {
    const automation = createAutomationApi();
    window.bbDesktop = createBbDesktopApi(TEST_DESKTOP_INFO);
    window.bbDesktop.automation = automation;

    const handlers = createHandlers();
    const socket = createFakeSocket();

    await handleAutomationCommand(
      openCommand(),
      handlers,
      socket as unknown as Parameters<typeof handleAutomationCommand>[2],
    );

    expect(automation.registerTarget).toHaveBeenCalledWith({
      targetId: "tgt_test",
      tabId: "browser:tab-1",
      threadId: "thr_test",
    });
    expect(automation.navigate).not.toHaveBeenCalled();
    expect(socket.send).toHaveBeenCalledTimes(1);
    const [sent] = socket.send.mock.calls[0] as [string];
    expect(JSON.parse(sent)).toEqual({
      type: "response",
      requestId: "req-1",
      ok: true,
      result: { tabId: "browser:tab-1" },
    });
  });

  it("sends an error response instead of hanging when no thread view is registered", async () => {
    const automation = createAutomationApi();
    window.bbDesktop = createBbDesktopApi(TEST_DESKTOP_INFO);
    window.bbDesktop.automation = automation;

    const handlers = createHandlers({
      onOpenTab: vi.fn(async () => {
        throw new Error("No desktop view is registered for automation thread thr_test");
      }),
    });
    const socket = createFakeSocket();

    await handleAutomationCommand(
      openCommand(),
      handlers,
      socket as unknown as Parameters<typeof handleAutomationCommand>[2],
    );

    expect(socket.send).toHaveBeenCalledTimes(1);
    const [sent] = socket.send.mock.calls[0] as [string];
    const parsed = JSON.parse(sent) as { ok: boolean; requestId: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.requestId).toBe("req-1");
  });
});
