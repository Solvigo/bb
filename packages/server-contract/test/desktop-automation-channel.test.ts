import { describe, expect, it } from "vitest";
import {
  DESKTOP_AUTOMATION_CHANNEL_CAPABILITY,
  desktopAutomationClientMessageSchema,
  desktopAutomationCommandMessageSchema,
  desktopAutomationRegisterMessageSchema,
} from "../src/api/desktop-automation-channel.js";

describe("desktop automation channel contracts", () => {
  it("accepts register and command messages", () => {
    expect(
      desktopAutomationRegisterMessageSchema.parse({
        type: "register",
        capabilities: [DESKTOP_AUTOMATION_CHANNEL_CAPABILITY],
      }),
    ).toEqual({
      type: "register",
      capabilities: [DESKTOP_AUTOMATION_CHANNEL_CAPABILITY],
    });
    expect(
      desktopAutomationCommandMessageSchema.parse({
        type: "command",
        requestId: "req_1",
        verb: "open",
        threadId: "thr_1",
        targetId: "tgt_1",
        payload: {
          targetId: "tgt_1",
          url: "https://example.com",
          visible: true,
        },
      }),
    ).toMatchObject({ verb: "open" });
    expect(
      desktopAutomationClientMessageSchema.parse({
        type: "response",
        requestId: "req_1",
        ok: true,
        result: { tabId: "browser:abc" },
      }),
    ).toMatchObject({ ok: true });
  });
});
