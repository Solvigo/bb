import { describe, expect, it } from "vitest";
import {
  resolveAutomationTargetIdForTab,
  registerDesktopAutomationThreadHandlers,
} from "./DesktopAutomationBridge";

describe("DesktopAutomationBridge", () => {
  it("tracks automation targets registered for a thread", () => {
    const unregister = registerDesktopAutomationThreadHandlers({
      threadId: "thr_a",
      onActivateTab: () => undefined,
      onCloseTab: () => undefined,
      onOpenTab: () => "browser:tab-1",
    });
    expect(resolveAutomationTargetIdForTab("browser:tab-1")).toBeNull();
    unregister();
  });
});
