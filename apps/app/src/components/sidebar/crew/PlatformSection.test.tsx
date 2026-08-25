// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PluginNavPanelRegistration } from "@bb/plugin-sdk";
import { PlatformSection } from "./PlatformSection";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";

function registerNavPanels(
  pluginId: string,
  navPanels: PluginNavPanelRegistration[],
): void {
  const set: PluginRegistrationSet = {
    homepageSections: [],
    settingsSections: [],
    navPanels,
    threadPanelActions: [],
    composerCustomizations: [],
    pendingInteractions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
  };
  setPluginSlotRegistrations(pluginId, set);
}

function renderSection() {
  return render(
    <MemoryRouter>
      <PlatformSection labelClassName="label" />
    </MemoryRouter>,
  );
}

function rowLabels(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.querySelector("span")?.textContent ?? "");
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

describe("PlatformSection", () => {
  it("renders only the three built-in rows when no plugin registers a panel", () => {
    renderSection();

    expect(rowLabels()).toEqual(["Skills", "Connections", "Defaults"]);
  });

  it("appends a registered nav panel below the built-ins, linking to its route", () => {
    registerNavPanels("story-split-page", [
      {
        id: "notes",
        title: "Project notes",
        icon: "FileText",
        path: "notes",
        component: () => null,
      },
    ]);

    renderSection();

    expect(rowLabels()).toEqual([
      "Skills",
      "Connections",
      "Defaults",
      "Project notes",
    ]);
    const rows = screen.getAllByRole("link");
    expect(rows[3]?.getAttribute("href")).toBe(
      "/plugins/story-split-page/notes",
    );
  });

  it("renders a row whose icon hint is not a known icon name", () => {
    registerNavPanels("demo", [
      {
        id: "board",
        title: "Board",
        icon: "not-a-real-icon",
        path: "board",
        component: () => null,
      },
    ]);

    expect(() => renderSection()).not.toThrow();
    expect(rowLabels()).toContain("Board");
  });

  it("keys rows per plugin so two plugins may register the same title", () => {
    registerNavPanels("alpha", [
      {
        id: "board",
        title: "Board",
        icon: "GridView",
        path: "board",
        component: () => null,
      },
    ]);
    registerNavPanels("zeta", [
      {
        id: "board",
        title: "Board",
        icon: "GridView",
        path: "board",
        component: () => null,
      },
    ]);

    renderSection();

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/tools/skills",
      "/settings/connections",
      "/settings/defaults",
      "/plugins/alpha/board",
      "/plugins/zeta/board",
    ]);
  });
});
