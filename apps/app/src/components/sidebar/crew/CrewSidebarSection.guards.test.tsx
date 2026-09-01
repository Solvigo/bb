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
  vi.fn(() => ({
    createCrew,
    creating: false,
    creatingFor: (_projectId: string) => false,
    error: null as string | null,
    lastAttempt: null as { projectId: string; openingRequest?: string } | null,
  })),
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

/**
 * jsdom builds no DataTransfer, so a drag fixture has to carry the same surface
 * the component uses: a data store whose keys show up in `types`, and the
 * drag-image call, which really does take the node the caller parked in the
 * document and leave it there for the caller to remove.
 */
function dragTransferStub() {
  const store = new Map<string, string>();
  // Kept as one live array so it survives being copied onto the synthetic
  // event; a getter would be snapshotted empty before setData ever runs.
  const types: string[] = [];
  return {
    effectAllowed: "move",
    dropEffect: "move",
    types,
    setData: (format: string, value: string) => {
      if (!store.has(format)) types.push(format);
      store.set(format, value);
    },
    getData: (format: string) => store.get(format) ?? "",
    setDragImage: vi.fn((_image: Element, _x: number, _y: number) => {}),
  };
}

vi.mock("./useCreateCrew", () => ({
  useCreateCrew: useCreateCrewMock,
}));

const useProjectNamesMock = vi.hoisted(() =>
  vi.fn(
    () =>
      new Map([
        ["proj_alpha", "Alpha Airways"],
        ["proj_beta", "Beta Build"],
      ]),
  ),
);
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useProjectNames: useProjectNamesMock,
}));

vi.mock("./useCrews", () => ({
  useCrews: useCrewsMock,
}));

import {
  CrewEditProvider,
  CrewSidebarSection,
  projectHasCrew,
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

describe("projectHasCrew", () => {
  it("counts crews and nothing else", () => {
    expect(
      projectHasCrew("proj_alpha", [sampleCrew("proj_alpha", "thr_a")]),
    ).toBe(true);
    expect(projectHasCrew("proj_beta", [])).toBe(false);
  });
});

describe("CrewSidebarSection one-crew affordance", () => {
  beforeEach(() => {
    useCreateCrewMock.mockReturnValue({
      createCrew,
      creating: false,
      creatingFor: () => false,
      error: null,
      lastAttempt: null,
    });
    useCrewsMock.mockReturnValue({
      crews: [sampleCrew("proj_alpha", "thr_alpha")],
      chats: [],
      pendingRoots: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    createCrew.mockClear();
    useProjectNamesMock.mockReturnValue(
      new Map([
        ["proj_alpha", "Alpha Airways"],
        ["proj_beta", "Beta Build"],
      ]),
    );
  });

  it("renders project cards with Add a crew when every project is crewless", () => {
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [],
      pendingRoots: [],
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

  it("still offers Add a crew on a project that only has a conversation", () => {
    // A chat is not a crew. Counting one as the project's root left a project
    // the operator had only ever talked in with no way to crew it, and nothing
    // on screen saying why.
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [sampleChat("proj_alpha", "thr_talk", "Some thinking")],
      pendingRoots: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    const groups = screen.getAllByTestId("sidebar-project-group");
    expect(within(groups[0]!).getByTestId("add-crew-button")).toBeTruthy();
    expect(within(groups[1]!).getByTestId("add-crew-button")).toBeTruthy();
  });

  it("does not offer a second crew affordance when a project already has one", () => {
    useCrewsMock.mockReturnValue({
      crews: [
        sampleCrew("proj_alpha", "thr_alpha"),
        sampleCrew("proj_alpha", "thr_beta"),
      ],
      chats: [],
      pendingRoots: [],
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
      pendingRoots: [],
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
      creatingFor: () => false,
      error: "No host is connected, so a crew cannot be started yet.",
      lastAttempt: { projectId: "proj_a" },
    });
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [],
      pendingRoots: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    expect(screen.getByTestId("crew-create-error").textContent).toContain(
      "No host is connected",
    );
  });

  it("keeps a failed setup inside its project, with the retry reachable", () => {
    // The dead end this guards: a standby left by a refused charter fell
    // through to Chats, where it read as a conversation AND counted as the
    // project's root — so Add a crew disappeared and nothing on screen could
    // finish the setup.
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [],
      pendingRoots: [
        { threadId: "thr_standby", name: "New crew", projectId: "proj_alpha" },
      ],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    const groups = screen.getAllByTestId("sidebar-project-group");
    const alpha = groups[0]!;
    // The standby's control is in ITS project block, not below in Chats, and
    // it says what it is rather than offering a second crew.
    const retry = within(alpha).getByTestId("retry-crew-button");
    expect(retry.textContent).toContain("Setup did not finish");
    expect(within(alpha).queryByTestId("add-crew-button")).toBeNull();
    // And the way out is right there, on the same card.
    fireEvent.click(retry);
    expect(createCrew).toHaveBeenCalledWith("proj_alpha");
    // The crewless project beside it still offers the ordinary affordance.
    expect(within(groups[1]!).getByTestId("add-crew-button")).toBeTruthy();
  });

  it("gives two crewless projects Add controls named for each", () => {
    // Every card carries a control reading "Add a crew"; without the project
    // in the name a screen reader hears the same button twice.
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [],
      pendingRoots: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    const addNames = screen
      .getAllByTestId("add-crew-button")
      .map((b) => b.getAttribute("aria-label"));
    expect(addNames).toEqual([
      "Add a crew to Alpha Airways",
      "Add a crew to Beta Build",
    ]);
    expect(new Set(addNames).size).toBe(addNames.length);
  });

  it("tells two UNRESOLVED projects apart, group and Retry alike", () => {
    // A group whose name has not arrived rendered as "this project", and so
    // did its Retry. Two of them were indistinguishable by ear.
    //
    // Unresolved and crewless cannot co-exist: a group exists either because
    // it is in the project-name map — which means it HAS a name — or because
    // it carries a crew or a standby. So the unresolved case is exercised
    // through the standbys that create it.
    useProjectNamesMock.mockReturnValue(new Map());
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [],
      pendingRoots: [
        { threadId: "thr_a", name: "New crew", projectId: "proj_alpha" },
        { threadId: "thr_b", name: "New crew", projectId: "proj_beta" },
      ],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    const groupNames = screen
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(groupNames).toEqual(["Unnamed project 1", "Unnamed project 2"]);
    expect(new Set(groupNames).size).toBe(groupNames.length);

    const retryNames = screen
      .getAllByTestId("retry-crew-button")
      .map((b) => b.getAttribute("aria-label"));
    expect(retryNames).toEqual([
      "Retry the unfinished crew setup on Unnamed project 1",
      "Retry the unfinished crew setup on Unnamed project 2",
    ]);
    expect(new Set(retryNames).size).toBe(retryNames.length);
  });

  it("gives the personal project a card when a standby is waiting there", () => {
    // Personal is the projectless bucket and stays out of the way when empty —
    // but a half-made root there still needs somewhere to carry its Retry.
    useCrewsMock.mockReturnValue({
      crews: [],
      chats: [],
      pendingRoots: [
        {
          threadId: "thr_p",
          name: "New crew",
          projectId: "proj_personal",
        },
      ],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    const groups = screen.getAllByTestId("sidebar-project-group");
    // Alpha, Beta, and Personal — which is only here because of the standby.
    expect(groups).toHaveLength(3);
    const retry = screen.getByTestId("retry-crew-button");
    expect(retry.textContent).toContain("Setup did not finish");
    fireEvent.click(retry);
    expect(createCrew).toHaveBeenCalledWith("proj_personal");
  });

  it("scopes project-root drop to the dragged agent's project while editing", () => {
    useCrewsMock.mockReturnValue({
      crews: [sampleCrew("proj_alpha", "thr_alpha")],
      chats: [],
      pendingRoots: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    });

    renderSection();

    // #68 renamed the affordance; the scoping it arms is what this asserts.
    fireEvent.click(screen.getByLabelText("Rearrange Crew thr_alpha"));

    const commander = screen.getByText("Crew thr_alpha").closest("a");
    expect(commander).toBeTruthy();
    fireEvent.dragStart(commander!, { dataTransfer: dragTransferStub() });

    expect(
      screen
        .getByTestId("project-root-drop-proj_alpha")
        .getAttribute("data-project-drop-active"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("project-root-drop-proj_beta")
        .getAttribute("data-project-drop-active"),
    ).toBe("false");
  });
});
