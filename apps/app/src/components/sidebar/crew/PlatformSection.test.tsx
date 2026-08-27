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
      <PlatformSection />
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
  it("carries exactly three rows", () => {
    renderSection();

    expect(rowLabels()).toEqual(["Skills", "Connections", "Defaults"]);
  });

  // The rail was overhauled to stop being a list of everything the instance
  // can do. Mounting each registered panel as a row put the whole kill-list
  // back — Tower, Airways, Knowledge and Automations returned beside the three
  // that survived. Three is the contract, and a plugin cannot add to it.
  it("stays three rows however many panels plugins register", () => {
    registerNavPanels("story-split-page", [
      {
        id: "notes",
        title: "Project notes",
        icon: "FileText",
        path: "notes",
        component: () => null,
      },
    ]);
    registerNavPanels("demo", [
      {
        id: "board",
        title: "Board",
        icon: "GridView",
        path: "board",
        component: () => null,
      },
    ]);

    renderSection();

    expect(rowLabels()).toEqual(["Skills", "Connections", "Defaults"]);
  });

  it("links each row to a screen that exists", () => {
    renderSection();

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/tools/skills", "/settings/connections", "/settings/defaults"]);
  });
});
