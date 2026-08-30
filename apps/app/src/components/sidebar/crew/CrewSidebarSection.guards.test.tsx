// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Crew, LooseChat } from "./useCrews";

const createCrew = vi.fn();
const useCreateCrewMock = vi.hoisted(() =>
  vi.fn(() => ({ createCrew, creating: false, error: null as string | null })),
);
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

function sampleChat(projectId: string, threadId: string, name: string): LooseChat {
  return {
    threadId,
    name,
    projectId,
    liveness: null,
  };
}

vi.mock("./useCreateCrew", () => ({
  useCreateCrew: useCreateCrewMock,
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
  projectHasRootThread,
} from "./CrewSidebarSection";

function renderSection() {
  return render(
    <MemoryRouter>
      <CrewEditProvider>
        <CrewSidebarSection />
      </CrewEditProvider>
    </MemoryRouter>,
  );
}

describe("projectHasRootThread", () => {
  it("counts crewed commanders and loose chat roots", () => {
    expect(
      projectHasRootThread("proj_alpha", [sampleCrew("proj_alpha", "thr_a")], []),
    ).toBe(true);
    expect(
      projectHasRootThread(
        "proj_alpha",
        [],
        [sampleChat("proj_alpha", "thr_setup", "New crew · setup")],
      ),
    ).toBe(true);
    expect(projectHasRootThread("proj_beta", [], [])).toBe(false);
  });
});

describe("CrewSidebarSection one-crew affordance", () => {
  beforeEach(() => {
    useCreateCrewMock.mockReturnValue({
      createCrew,
      creating: false,
      error: null,
    });
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

  it("renders project cards with Add a crew when every project is crewless", () => {
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    const groups = screen.getAllByTestId("sidebar-project-group");
    expect(groups).toHaveLength(2);
    expect(screen.getAllByTestId("add-crew-button")).toHaveLength(2);
  });

  it("offers Add a crew only on projects that have no root thread yet", () => {
    renderSection();

    const groups = screen.getAllByTestId("sidebar-project-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).queryByTestId("add-crew-button")).toBeNull();
    expect(within(groups[1]!).getByTestId("add-crew-button")).toBeTruthy();
  });

  it("does not offer a second crew when a setup commander exists as a chat root", () => {
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [
        sampleChat("proj_alpha", "thr_setup", "New crew · setup"),
      ],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    const groups = screen.getAllByTestId("sidebar-project-group");
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

    renderSection();

    const groups = screen.getAllByTestId("sidebar-project-group");
    expect(groups).toHaveLength(2);
    expect(screen.queryAllByTestId("add-crew-button")).toHaveLength(1);
    expect(within(groups[0]!).queryByTestId("add-crew-button")).toBeNull();
  });

  it("wires createCrew to the clicked project's id", () => {
    useCrewsMock.mockReturnValue({
      crews: [sampleCrew("proj_alpha", "thr_alpha")],
      chats: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    fireEvent.click(screen.getByTestId("add-crew-button"));
    expect(createCrew).toHaveBeenCalledWith("proj_beta");
  });

  it("surfaces crew creation refusal on screen", () => {
    useCreateCrewMock.mockReturnValue({
      createCrew,
      creating: false,
      error: "No host is connected, so a crew cannot be started yet.",
    });
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    expect(screen.getByTestId("crew-create-error")).toHaveTextContent(
      "No host is connected",
    );
  });

  it("scopes project-root drop to the dragged agent's project while editing", () => {
    useCrewsMock.mockReturnValue({
      crews: [sampleCrew("proj_alpha", "thr_alpha")],
      chats: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    fireEvent.click(screen.getByLabelText("Edit the crew"));

    const commander = screen.getByText("Crew thr_alpha").closest("a");
    expect(commander).toBeTruthy();
    fireEvent.dragStart(commander!, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "move" },
    });

    expect(screen.getByTestId("project-root-drop-proj_alpha")).toHaveAttribute(
      "data-project-drop-active",
      "true",
    );
    expect(screen.getByTestId("project-root-drop-proj_beta")).toHaveAttribute(
      "data-project-drop-active",
      "false",
    );
  });
});
