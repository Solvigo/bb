import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_VERB,
  desktopAutomationCommandMessageSchema,
  desktopAutomationRegisterMessageSchema,
} from "@bb/server-contract";
import {
  DesktopAutomationChannelCoordinator,
  DesktopAutomationChannelUnavailableError,
} from "../../src/services/browser/desktop-automation-channel.js";
import {
  onDesktopAutomationSocketMessage,
  onDesktopAutomationSocketOpen,
} from "../../src/ws/desktop-automation-protocol.js";

describe("desktop automation channel coordinator", () => {
  it("rejects commands when no desktop client is connected", async () => {
    const channel = new DesktopAutomationChannelCoordinator();
    await expect(
      channel.forwardCommand({
        verb: BROWSER_VERB.open,
        threadId: "thr_test",
        payload: { targetId: "tgt_test", url: "https://example.com", visible: true },
      }),
    ).rejects.toBeInstanceOf(DesktopAutomationChannelUnavailableError);
  });

  it("resolves pending commands from client responses", async () => {
    const channel = new DesktopAutomationChannelCoordinator();
    const socket = { send: vi.fn(), close: vi.fn() };
    onDesktopAutomationSocketOpen(channel, socket);
    onDesktopAutomationSocketMessage(
      channel,
      socket,
      JSON.stringify(
        desktopAutomationRegisterMessageSchema.parse({
          type: "register",
          capabilities: ["browser-automation-v1"],
        }),
      ),
    );

    const pending = channel.forwardCommand({
      verb: BROWSER_VERB.snapshot,
      threadId: "thr_test",
      targetId: "tgt_test",
      payload: { targetId: "tgt_test" },
    });
    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(socket.send.mock.calls[0]?.[0]));
    const command = desktopAutomationCommandMessageSchema.parse(sent);
    channel.handleClientMessage({
      type: "response",
      requestId: command.requestId,
      ok: true,
      result: { url: "https://example.com", title: "Example", text: "hello" },
    });
    await expect(pending).resolves.toEqual({
      url: "https://example.com",
      title: "Example",
      text: "hello",
    });
  });

  it("dispatches to the most recently registered client, not the oldest", () => {
    const channel = new DesktopAutomationChannelCoordinator();
    const stale = { send: vi.fn(), close: vi.fn() };
    const current = { send: vi.fn(), close: vi.fn() };
    // Simulates a desktop app relaunch: the old window's socket never sent a
    // close frame (e.g. the process was killed), so it is still "connected"
    // from the server's point of view when the new window registers.
    channel.registerClient(stale);
    channel.registerClient(current);

    void channel.forwardCommand({
      verb: BROWSER_VERB.open,
      threadId: "thr_test",
      targetId: "tgt_test",
      payload: { targetId: "tgt_test", url: "https://example.com", visible: true },
    });

    expect(current.send).toHaveBeenCalledTimes(1);
    expect(stale.send).not.toHaveBeenCalled();
  });

  it("falls back to the remaining client once the preferred one disconnects", () => {
    const channel = new DesktopAutomationChannelCoordinator();
    const first = { send: vi.fn(), close: vi.fn() };
    const second = { send: vi.fn(), close: vi.fn() };
    channel.registerClient(first);
    channel.registerClient(second);
    channel.unregisterClient(second);

    void channel.forwardCommand({
      verb: BROWSER_VERB.open,
      threadId: "thr_test",
      targetId: "tgt_test",
      payload: { targetId: "tgt_test", url: "https://example.com", visible: true },
    });

    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
  });
});
