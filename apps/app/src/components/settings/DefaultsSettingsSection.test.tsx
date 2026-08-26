// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FleetDefaultState } from "@/hooks/queries/fleet-default";

let fleetDefault: {
  data: FleetDefaultState | undefined;
  isPending: boolean;
};
let executionOptions: {
  data: unknown;
  isPending: boolean;
  isError: boolean;
};

vi.mock("@/hooks/queries/fleet-default", () => ({
  useFleetDefault: () => fleetDefault,
  useSetFleetDefault: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    data: undefined,
  }),
  useClearFleetDefault: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    data: undefined,
  }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemExecutionOptions: () => executionOptions,
}));

import { DefaultsSettingsSection } from "./DefaultsSettingsSection";

const RESOLVED_FALLBACK = {
  data: {
    providers: [{ id: "codex", displayName: "Codex", available: true }],
    models: [
      { model: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", isDefault: true },
      { model: "claude-sonnet-5", displayName: "Sonnet 5", isDefault: false },
    ],
  },
  isPending: false,
  isError: false,
};

describe("the Defaults screen", () => {
  beforeEach(() => {
    executionOptions = RESOLVED_FALLBACK;
    fleetDefault = { data: undefined, isPending: true };
  });
  afterEach(() => {
    cleanup();
  });

  // The defect this screen was rebuilt for: it showed bb's last-moment
  // resolution as the answer while a different pair sat in the store, so it
  // told the operator a new agent would get a harness the fleet had retired.
  it("answers with the stored pair, never the resolution, when one is stored", () => {
    fleetDefault = {
      isPending: false,
      data: {
        kind: "stored",
        providerId: "claude-code",
        modelId: "claude-sonnet-5",
        setAt: new Date().toISOString(),
        setBy: "operator:admin",
        providers: [
          { id: "claude-code", displayName: "Claude Code", available: true },
          { id: "codex", displayName: "Codex", available: true },
        ],
        providersError: null,
      },
    };
    render(<DefaultsSettingsSection />);

    // The answer line itself, not the picker or the harness list — all three
    // say "Claude Code" and only one of them is the answer.
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" &&
          element.textContent === "Claude Code · Sonnet 5",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/This is the stored answer/)).toBeTruthy();
    expect(screen.queryByText(/GPT-5.6-Sol/)).toBeNull();
    expect(screen.queryByText(/Nothing is saved/)).toBeNull();
  });

  it("falls back to the resolution only when the store is explicitly empty", () => {
    fleetDefault = {
      isPending: false,
      data: {
        kind: "none",
        providers: [{ id: "codex", displayName: "Codex", available: true }],
        providersError: null,
      },
    };
    render(<DefaultsSettingsSection />);

    expect(screen.getByText(/GPT-5.6-Sol/)).toBeTruthy();
    expect(screen.getByText(/Nothing is saved/)).toBeTruthy();
  });

  // A read that failed is not an empty store. Rendering the fallback here
  // would be the same lie in a different costume.
  it("shows nothing at all when the store could not be read", () => {
    fleetDefault = {
      isPending: false,
      data: { kind: "unreadable", timedOut: true },
    };
    render(<DefaultsSettingsSection />);

    expect(screen.getByText(/did not answer in time/)).toBeTruthy();
    expect(screen.queryByText(/GPT-5.6-Sol/)).toBeNull();
    expect(screen.queryByText(/Nothing is saved/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("passes the store's own refusal through verbatim", () => {
    fleetDefault = {
      isPending: false,
      data: { kind: "refused", error: "crew: defaults are rank-gated here" },
    };
    render(<DefaultsSettingsSection />);

    expect(
      screen.getByText("crew: defaults are rank-gated here"),
    ).toBeTruthy();
    expect(screen.queryByText(/GPT-5.6-Sol/)).toBeNull();
  });
});
