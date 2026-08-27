import {
  DESKTOP_AUTOMATION_CHANNEL_CAPABILITY,
  desktopAutomationClientMessageSchema,
  desktopAutomationRegisterMessageSchema,
} from "@bb/server-contract";
import type { DesktopAutomationChannelCoordinator } from "../services/browser/desktop-automation-channel.js";
import { decodeSocketPayload } from "./decode-payload.js";

interface DesktopAutomationSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function onDesktopAutomationSocketOpen(
  channel: DesktopAutomationChannelCoordinator,
  socket: DesktopAutomationSocket,
): void {
  channel.registerClient(socket);
}

export function onDesktopAutomationSocketMessage(
  channel: DesktopAutomationChannelCoordinator,
  socket: DesktopAutomationSocket,
  raw: unknown,
): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeSocketPayload(raw));
  } catch {
    socket.close(1008, "invalid-message");
    return;
  }

  const register = desktopAutomationRegisterMessageSchema.safeParse(decoded);
  if (register.success) {
    if (
      !register.data.capabilities.includes(
        DESKTOP_AUTOMATION_CHANNEL_CAPABILITY,
      )
    ) {
      socket.close(1008, "unsupported-capability");
    }
    return;
  }

  const parsed = desktopAutomationClientMessageSchema.safeParse(decoded);
  if (!parsed.success) {
    socket.close(1008, "invalid-message");
    return;
  }
  if (parsed.data.type === "register") {
    return;
  }
  channel.handleClientMessage(parsed.data);
}

export function onDesktopAutomationSocketClose(
  channel: DesktopAutomationChannelCoordinator,
  socket: DesktopAutomationSocket,
): void {
  channel.unregisterClient(socket);
}
