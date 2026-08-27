import ReconnectingWebSocket from "partysocket/ws";
import {
  BROWSER_VERB,
  DESKTOP_AUTOMATION_CHANNEL_CAPABILITY,
  desktopAutomationCommandMessageSchema,
  desktopAutomationRegisterMessageSchema,
  type DesktopAutomationCommandMessage,
} from "@bb/server-contract";
import { buildDevWebSocketUrl } from "./dev-websocket-url";
import { getDesktopAutomationApi } from "./bb-desktop";

export interface DesktopAutomationCommandHandlers {
  onCloseTab: (args: { tabId: string; targetId: string }) => void;
  onOpenTab: (args: {
    targetId: string;
    threadId: string;
    url: string;
    visible: boolean;
  }) => Promise<{ tabId: string }>;
  onStopTarget: (args: { targetId: string }) => Promise<void>;
  resolveTabId: (targetId: string) => string | null;
}

function automationSocketUrl(): string {
  return (
    buildDevWebSocketUrl({ path: "/ws/desktop-automation" }) ??
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/desktop-automation`
  );
}

function sendResponse(
  socket: ReconnectingWebSocket,
  requestId: string,
  ok: boolean,
  body: { result?: unknown; error?: { code: string; message: string } },
): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(
    JSON.stringify(
      ok
        ? { type: "response", requestId, ok: true, result: body.result ?? null }
        : {
            type: "response",
            requestId,
            ok: false,
            error: body.error,
          },
    ),
  );
}

export async function handleAutomationCommand(
  command: DesktopAutomationCommandMessage,
  handlers: DesktopAutomationCommandHandlers,
  socket: ReconnectingWebSocket,
): Promise<void> {
  const automation = getDesktopAutomationApi();
  if (automation === null) {
    sendResponse(socket, command.requestId, false, {
      error: {
        code: "desktop_automation_unavailable",
        message: "Desktop automation API is unavailable in this shell",
      },
    });
    return;
  }

  try {
    switch (command.verb) {
      case BROWSER_VERB.open: {
        const payload = command.payload as {
          targetId: string;
          url: string;
          visible?: boolean;
        };
        const opened = await handlers.onOpenTab({
          targetId: payload.targetId,
          threadId: command.threadId,
          url: payload.url,
          visible: payload.visible ?? false,
        });
        await automation.registerTarget({
          targetId: payload.targetId,
          tabId: opened.tabId,
          threadId: command.threadId,
        });
        // handlers.onOpenTab already loads payload.url on the tab's native
        // view; do not also navigate here, or the CDP navigate races the
        // native view's own in-flight load to the same URL.
        sendResponse(socket, command.requestId, true, {
          result: { tabId: opened.tabId },
        });
        return;
      }
      case BROWSER_VERB.navigate: {
        const payload = command.payload as { targetId: string; url: string };
        await automation.navigate(payload);
        sendResponse(socket, command.requestId, true, { result: null });
        return;
      }
      case BROWSER_VERB.snapshot: {
        const payload = command.payload as { targetId: string };
        const snapshot = await automation.snapshot(payload.targetId);
        sendResponse(socket, command.requestId, true, { result: snapshot });
        return;
      }
      case BROWSER_VERB.click: {
        await automation.click(
          command.payload as Parameters<typeof automation.click>[0],
        );
        sendResponse(socket, command.requestId, true, { result: null });
        return;
      }
      case BROWSER_VERB.type: {
        await automation.type(
          command.payload as Parameters<typeof automation.type>[0],
        );
        sendResponse(socket, command.requestId, true, { result: null });
        return;
      }
      case BROWSER_VERB.eval: {
        const payload = command.payload as { targetId: string; script: string };
        const result = await automation.eval(payload);
        sendResponse(socket, command.requestId, true, { result });
        return;
      }
      case BROWSER_VERB.close: {
        const payload = command.payload as { targetId: string };
        await automation.close(payload.targetId);
        const tabId = handlers.resolveTabId(payload.targetId);
        if (tabId !== null) {
          handlers.onCloseTab({ tabId, targetId: payload.targetId });
        }
        await automation.unregisterTarget({ targetId: payload.targetId });
        sendResponse(socket, command.requestId, true, { result: null });
        return;
      }
      default:
        sendResponse(socket, command.requestId, false, {
          error: {
            code: "unsupported_verb",
            message: `Unsupported browser automation verb: ${command.verb}`,
          },
        });
    }
  } catch (error) {
    sendResponse(socket, command.requestId, false, {
      error: {
        code: "desktop_automation_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export function connectDesktopAutomationChannel(
  handlers: DesktopAutomationCommandHandlers,
): () => void {
  if (getDesktopAutomationApi() === null) {
    return () => undefined;
  }
  const socket = new ReconnectingWebSocket(automationSocketUrl(), undefined, {
    minReconnectionDelay: 1000,
    maxReconnectionDelay: 30000,
    connectionTimeout: 10000,
    maxRetries: Infinity,
  });
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify(
        desktopAutomationRegisterMessageSchema.parse({
          type: "register",
          capabilities: [DESKTOP_AUTOMATION_CHANNEL_CAPABILITY],
        }),
      ),
    );
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    const command = desktopAutomationCommandMessageSchema.safeParse(parsed);
    if (!command.success) {
      return;
    }
    void handleAutomationCommand(command.data, handlers, socket);
  });
  return () => {
    socket.close();
  };
}
