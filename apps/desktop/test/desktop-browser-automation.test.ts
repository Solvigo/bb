import { describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import { automationSnapshot } from "../src/desktop-browser-automation.js";

function createMockWebContents(): WebContents {
  const debugger_ = {
    isAttached: () => false,
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn(async (method: string) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            value: { title: "Example", text: "body text" },
          },
        };
      }
      return {};
    }),
  };
  return {
    debugger: debugger_,
    getURL: () => "https://example.com",
    isDestroyed: () => false,
  } as unknown as WebContents;
}

describe("desktop browser automation", () => {
  it("captures url, title, and text for snapshots", async () => {
    const webContents = createMockWebContents();
    await expect(automationSnapshot(webContents)).resolves.toEqual({
      url: "https://example.com",
      title: "Example",
      text: "body text",
    });
  });
});
