// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@bb/domain";

let executionOptions: { data: unknown; isPending: boolean; isError: boolean };
let fleetDefault: { data: unknown };

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemExecutionOptions: () => executionOptions,
}));
vi.mock("@/hooks/queries/fleet-default", () => ({
  useFleetDefault: () => fleetDefault,
}));

import { ProvidersSettingsSection } from "./ProvidersSettingsSection";

function provider(id: string, displayName: string, available = true) {
  return {
    id,
    displayName,
    available,
    logoUrl: null,
    composerActions: [],
    capabilities: {
      supportsArchive: true,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: false,
      supportsFork: false,
      supportedPermissionModes: [],
    },
  };
}

const SETTINGS = {
  codexMemoryEnabled: true,
  claudeCodeMemoryEnabled: true,
  codexSubagentsDisabled: false,
  claudeCodeSubagentsDisabled: false,
  claudeCodeWorkflowsDisabled: false,
} as unknown as AppSettings;

function renderSection(onSettingsChange = vi.fn()) {
  render(
    <ProvidersSettingsSection
      settings={SETTINGS}
      disabled={false}
      onSettingsChange={onSettingsChange}
    />,
  );
  return onSettingsChange;
}

beforeEach(() => {
  executionOptions = {
    data: {
      providers: [
        provider("codex", "Codex"),
        provider("claude-code", "Claude Code"),
        provider("pi", "Pi"),
        provider("acp-cursor", "Cursor", false),
      ],
    },
    isPending: false,
    isError: false,
  };
  fleetDefault = { data: { kind: "stored", providerId: "claude-code" } };
});
afterEach(() => cleanup());

describe("the harnesses page", () => {
  // The defect: the settings nav named two harnesses by hand, so an instance
  // that knew four showed two and the other two could not be reached at all.
  it("lists every harness the instance knows, not a hardcoded pair", () => {
    renderSection();

    for (const name of ["Codex", "Claude Code", "Pi", "Cursor"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("says a harness has no bb settings rather than showing an empty box", () => {
    renderSection();

    const pi = screen.getByTestId("provider-pi");
    expect(pi.textContent).toContain("no bb settings of its own");
    expect(pi.querySelector("[role=switch]")).toBeNull();
  });

  it("marks which harness a new agent gets", () => {
    renderSection();

    expect(screen.getByTestId("provider-claude-code").textContent).toContain(
      "default for new agents",
    );
    expect(screen.getByTestId("provider-codex").textContent).not.toContain(
      "default for new agents",
    );
  });

  // Stored as "disabled", shown as the capability itself: a switch labelled
  // "native subagents" that is ON when the field says disabled would be a lie.
  it("shows a disabled-stored toggle the right way round", () => {
    const onChange = renderSection();
    const subagents = screen.getByLabelText("Codex — Native subagents");

    expect(subagents.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(subagents);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ codexSubagentsDisabled: true }),
    );
  });

  it("does not claim an empty instance while the read is still running", () => {
    executionOptions = { data: undefined, isPending: true, isError: false };
    renderSection();

    expect(screen.getByText(/Asking the instance/)).toBeTruthy();
    expect(screen.queryByText(/listed no harnesses/)).toBeNull();
  });
});
