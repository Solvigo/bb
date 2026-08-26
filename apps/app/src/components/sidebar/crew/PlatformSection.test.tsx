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

function renderSection(railPluginPanels?: readonly string[]) {
  return render(
    <MemoryRouter>
      <PlatformSection
        labelClassName="label"
        {...(railPluginPanels ? { railPluginPanels } : {})}
      />
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

  // The rail was overhauled to stop being a list of everything the instance
  // can do; auto-mounting every plugin panel put the whole graveyard back —
  // Tower, Airways, Knowledge and Automations reappeared beside the three that
  // survived. Three is the contract.
  it("does not put a registered nav panel on the rail", () => {
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

    expect(rowLabels()).toEqual(["Skills", "Connections", "Defaults"]);
  });

  it("shows a panel that has been curated onto the rail, linking to its route", () => {
    registerNavPanels("story-split-page", [
      {
        id: "notes",
        title: "Project notes",
        icon: "FileText",
        path: "notes",
        component: () => null,
      },
    ]);

    renderSection(["story-split-page:notes"]);

    expect(rowLabels()).toEqual([
      "Skills",
      "Connections",
      "Defaults",
      "Project notes",
    ]);
    expect(screen.getAllByRole("link")[3]?.getAttribute("href")).toBe(
      "/plugins/story-split-page/notes",
    );
  });

  it("curates by plugin AND panel id, so one plugin's row does not admit another's", () => {
    registerNavPanels("alpha", [
      {
        id: "board",
        title: "Alpha board",
        icon: "GridView",
        path: "board",
        component: () => null,
      },
    ]);
    registerNavPanels("zeta", [
      {
        id: "board",
        title: "Zeta board",
        icon: "GridView",
        path: "board",
        component: () => null,
      },
    ]);

    renderSection(["alpha:board"]);

    expect(rowLabels()).toEqual([
      "Skills",
      "Connections",
      "Defaults",
      "Alpha board",
    ]);
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

    expect(() => renderSection(["demo:board"])).not.toThrow();
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

    renderSection(["alpha:board", "zeta:board"]);

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
