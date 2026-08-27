// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PluginSettingsCompatibilityRoute } from "./PluginSettingsCompatibilityRoute";

function ToolsPluginsLocation() {
  const location = useLocation();
  return (
    <div>
      Tools plugins
      <output data-testid="tools-plugins-location">
        {location.pathname}
        {location.search}
      </output>
    </div>
  );
}

function renderRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/settings/plugins"
          element={
            <PluginSettingsCompatibilityRoute>
              <div>Settings plugin manager</div>
            </PluginSettingsCompatibilityRoute>
          }
        />
        <Route
          path="/settings/plugins/:pluginId"
          element={
            <PluginSettingsCompatibilityRoute>
              <div>Settings plugin detail</div>
            </PluginSettingsCompatibilityRoute>
          }
        />
        <Route path="/tools/plugins" element={<ToolsPluginsLocation />} />
        <Route
          path="/tools/plugins/:pluginId"
          element={<div>Tools plugin detail</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PluginSettingsCompatibilityRoute", () => {
  afterEach(cleanup);

  it("keeps Settings plugin detail routes available", () => {
    renderRoute("/settings/plugins/example");

    expect(screen.getByText("Settings plugin detail")).toBeTruthy();
    expect(screen.queryByText("Tools plugin detail")).toBeNull();
  });

  it("moves legacy plugin management to Extensions", () => {
    renderRoute("/settings/plugins");

    expect(screen.getByText("Tools plugins")).toBeTruthy();
    expect(screen.getByTestId("tools-plugins-location").textContent).toBe(
      "/tools/plugins?view=installed",
    );
    expect(screen.queryByText("Settings plugin manager")).toBeNull();
  });
});
