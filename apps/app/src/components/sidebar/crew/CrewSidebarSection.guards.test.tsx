// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Crew } from "./useCrews";

const createCrew = vi.fn();
const useCrewsMock = vi.hoisted(() => vi.fn());

function sampleCrew(projectId: string, commanderThreadId: string): Crew {
  return {
    commanderThreadId,
    name: `Crew ${commanderThreadId}`,
    projectId,
    leads: [],
    status: "Standing by",
    liveness: null,
    attention: 0,
  };
}

vi.mock("./useCreateCrew", () => ({
  useCreateCrew: () => ({ createCrew, creating: false }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useProjectNames: () =>
    new Map([
      ["proj_alpha", "Alpha Airways"],
      ["proj_beta", "Beta Build"],
    ]),
}));

vi.mock("./useCrews", () => ({
  useCrews: useCrewsMock,
}));

import {
  CrewEditProvider,
  CrewSidebarSection,
} from "./CrewSidebarSection";

describe("CrewSidebarSection one-crew affordance", () => {
  beforeEach(() => {
    useCrewsMock.mockReturnValue({
      crews: [sampleCrew("proj_alpha", "thr_alpha")],
      chats: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    createCrew.mockClear();
  });

  it("offers Add a crew only on projects that have none yet", () => {
    render(
      <CrewEditProvider>
        <CrewSidebarSection />
      </CrewEditProvider>,
    );

    const groups = screen.getAllByTestId("sidebar-project-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).queryByTestId("add-crew-button")).toBeNull();
    expect(within(groups[1]!).getByTestId("add-crew-button")).toBeTruthy();
  });

  it("does not offer a second crew affordance when a project already has one", () => {
    useCrewsMock.mockReturnValue({
      crews: [
        sampleCrew("proj_alpha", "thr_alpha"),
        sampleCrew("proj_alpha", "thr_beta"),
      ],
      chats: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    render(
      <CrewEditProvider>
        <CrewSidebarSection />
      </CrewEditProvider>,
    );

    const groups = screen.getAllByTestId("sidebar-project-group");
    expect(groups).toHaveLength(2);
    expect(screen.queryAllByTestId("add-crew-button")).toHaveLength(1);
    expect(within(groups[0]!).queryByTestId("add-crew-button")).toBeNull();
  });
});
