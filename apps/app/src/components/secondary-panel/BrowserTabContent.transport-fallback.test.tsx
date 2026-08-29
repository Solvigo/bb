// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { STREAMED_BROWSER_TAB_ID } from "@/lib/streamed-browser-surface";
import { BrowserTabContent } from "./BrowserTabContent";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function registerStreamedBrowserPlugin(): void {
  setPluginSlotRegistrations("streamed-browser-test", {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    agentSurfaceTabs: [
      {
        id: STREAMED_BROWSER_TAB_ID,
        label: "Browser",
        icon: "Globe",
        title: "Browser",
        component: () => <p>streamed browser surface</p>,
      },
    ],
  });
}

function renderBrowserTab() {
  return render(
    <BrowserTabContent
      tabId="browser:test"
      initialUrl="https://example.com"
      addressFocusRequest={null}
      canShowNativeBrowserView={false}
      visibilityCoordinator={null}
      environmentId={null}
      threadId="thread-1"
      onUpdate={() => {}}
    />,
  );
}

describe("BrowserTabContent transport fallback", () => {
  afterEach(() => {
    cleanup();
    resetPluginSlotStoreForTest();
    resetAllCrashedPluginSlotsForTest();
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete window.bbDesktop;
  });

  it("renders the registered streamed surface when no native browser exists", () => {
    registerStreamedBrowserPlugin();

    renderBrowserTab();

    expect(screen.getByText("streamed browser surface")).toBeTruthy();
    expect(screen.queryByText("Browser tabs need the desktop app")).toBeNull();
  });

  it("falls back to the placeholder when neither transport exists", () => {
    renderBrowserTab();

    expect(screen.getByText("Browser tabs need the desktop app")).toBeTruthy();
  });

  it("prefers the native browser when it is present, even if a streamed surface is registered", () => {
    registerStreamedBrowserPlugin();
    window.bbDesktop = createBbDesktopApi(
      desktopInfo,
      createNoopDesktopBrowserApi(),
    );

    renderBrowserTab();

    expect(screen.getByTestId("browser-tab-nav-bar")).toBeTruthy();
    expect(screen.queryByText("streamed browser surface")).toBeNull();
    expect(screen.queryByText("Browser tabs need the desktop app")).toBeNull();
  });
});
