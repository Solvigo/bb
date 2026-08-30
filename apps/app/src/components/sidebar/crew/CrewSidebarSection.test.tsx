// @vitest-environment jsdom


import { cleanup, render, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  ChatsSidebarSection,
  CrewSidebarSection,
  CrewEditProvider,
} from "./CrewSidebarSection";
import * as useCrewsModule from "./useCrews";
import * as queryHooks from "@/hooks/queries/sidebar-navigation-query";

vi.mock("./useCrews", async () => {
  const actual = await vi.importActual<any>("./useCrews");
  return {
    ...actual,
    useCrews: vi.fn(),
    reparentAgent: vi.fn().mockResolvedValue({ ok: true }),
  };
});

vi.mock("./useCreateCrew", () => ({
  useCreateCrew: () => ({ createCrew: vi.fn(), creating: false }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useProjectNames: vi.fn(),
}));

// Each `it` below renders its own tree; without this, unmounted trees from
// earlier tests stay in the jsdom document and `getByRole` queries that
// matched one row uniquely start matching the same row N times over.
afterEach(() => {
  cleanup();
});

describe("CrewSidebarSection drag boundary", () => {
  it("refuses dropping an ancestor into a descendant's gap", async () => {
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(new Map([["p1", "Project 1"]]));

    const mockCrews = [
      {
        projectId: "p1",
        commanderThreadId: "root_cmd",
        name: "Root Crew",
        status: "idle",
        liveness: null,
        attention: 0,
        leads: [
          {
            threadId: "lead_1",
            name: "Child Lead",
            liveness: null,
            attention: 0,
            sorties: [
              {
                threadId: "sortie_1",
                name: "Grandchild Sortie",
                liveness: null,
                attention: 0,
                sorties: [],
              },
            ],
          },
        ],
      },
    ];

    vi.mocked(useCrewsModule.useCrews).mockReturnValue({
      crews: mockCrews,
      chats: [],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    } as any);

    const { container } = render(
      <MemoryRouter>
        <CrewEditProvider>
          <CrewSidebarSection />
        </CrewEditProvider>
      </MemoryRouter>
    );

    // Expand edit mode by clicking edit on root
    const editBtn = screen.getByRole("button", { name: "Rearrange Root Crew" });
    fireEvent.click(editBtn);

    // Expand the child lead so we can see its gaps
    const expandBtn = screen.getByRole("button", { name: "Show the agents under Child Lead" });
    fireEvent.click(expandBtn);

    // The ancestor is the root crew link.
    const rootLink = screen.getByRole("link", { name: /Root Crew/ });

    const dataTransfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      getData: vi.fn().mockReturnValue("root_cmd"),
      types: ["application/x-bb-agent"],
      effectAllowed: "uninitialized",
      dropEffect: "none",
    } as unknown as DataTransfer;

    fireEvent.dragStart(rootLink, { dataTransfer });

    // Find all gaps (InsertionZones)
    const gaps = container.querySelectorAll(".relative.-my-1");
    expect(gaps.length).toBeGreaterThan(0);

    gaps.forEach((gap) => {
      // The gap should have the visual forbidden class
      expect(gap.className).toContain("cursor-not-allowed");
      expect(gap.className).toContain("opacity-40");

      fireEvent.dragOver(gap, { dataTransfer });
      // The dropEffect should be 'none' when dragging an ancestor over its descendant's gap
      expect(dataTransfer.dropEffect).toBe("none");

      fireEvent.drop(gap, { dataTransfer });
      expect(useCrewsModule.reparentAgent).not.toHaveBeenCalled();
    });
  });
});

describe("CrewSidebarSection edit-scope guards", () => {
  function makeDataTransfer(id: string) {
    return {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      getData: vi.fn().mockReturnValue(id),
      types: ["application/x-bb-agent"],
      effectAllowed: "uninitialized",
      dropEffect: "none",
    } as unknown as DataTransfer;
  }

  function renderTwoCrewsAndAChat() {
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([["p1", "Project 1"]]),
    );

    const mockCrews = [
      {
        projectId: "p1",
        commanderThreadId: "cmd_a",
        name: "Crew A",
        status: "idle",
        liveness: null,
        attention: 0,
        leads: [
          {
            threadId: "lead_a",
            name: "Lead A",
            liveness: null,
            attention: 0,
            sorties: [],
          },
        ],
      },
      {
        projectId: "p1",
        commanderThreadId: "cmd_b",
        name: "Crew B",
        status: "idle",
        liveness: null,
        attention: 0,
        leads: [
          {
            threadId: "lead_b",
            name: "Lead B",
            liveness: null,
            attention: 0,
            sorties: [],
          },
        ],
      },
    ];

    vi.mocked(useCrewsModule.useCrews).mockReturnValue({
      crews: mockCrews,
      chats: [
        {
          threadId: "chat_1",
          name: "Loose Chat",
          projectId: "p1",
          liveness: null,
        },
      ],
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    } as any);

    return render(
      <MemoryRouter>
        <CrewEditProvider>
          <CrewSidebarSection />
          <ChatsSidebarSection />
        </CrewEditProvider>
      </MemoryRouter>,
    );
  }

  function editCrew(name: string) {
    fireEvent.click(screen.getByRole("button", { name: `Rearrange ${name}` }));
  }

  beforeEach(() => {
    vi.mocked(useCrewsModule.reparentAgent).mockClear();
  });

  it("does not arm a drag from a row while no crew is being edited", () => {
    renderTwoCrewsAndAChat();

    // Neither crew is being edited yet, so this row is not a legitimate drag
    // source — but a synthetic dragstart bypasses the draggable attribute, so
    // the handler itself has to refuse.
    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    expect(crewALink.getAttribute("draggable")).toBe("false");
    fireEvent.dragStart(crewALink, { dataTransfer: makeDataTransfer("cmd_a") });

    // If the guard had not held, this drag would already be "in the air" and
    // entering edit mode on Crew A would show its gaps immediately, with no
    // second drag ever started.
    editCrew("Crew A");
    expect(document.querySelectorAll(".relative.-my-1").length).toBe(0);
  });

  it("refuses a Shift+Delete move on a row outside the edited crew's scope", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const leadBLink = screen.getByRole("link", { name: /Lead B/ });
    expect(leadBLink.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(leadBLink, { key: "Delete", shiftKey: true });
    expect(useCrewsModule.reparentAgent).not.toHaveBeenCalled();
  });

  it("honors Shift+Backspace inside the edited crew's own scope", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const leadALink = screen.getByRole("link", { name: /Lead A/ });
    expect(leadALink.getAttribute("tabindex")).not.toBe("-1");
    fireEvent.keyDown(leadALink, { key: "Backspace", shiftKey: true });
    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith("lead_a", null);
  });

  it("refuses a drop onto a row outside the edited crew, without reparenting", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    const dataTransfer = makeDataTransfer("cmd_a");
    fireEvent.dragStart(crewALink, { dataTransfer });

    const crewBLink = screen.getByRole("link", { name: /Crew B/ });
    fireEvent.dragOver(crewBLink, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("none");

    fireEvent.drop(crewBLink, { dataTransfer });
    expect(useCrewsModule.reparentAgent).not.toHaveBeenCalled();
  });

  it("keeps a loose chat non-draggable while a crew is being edited", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const chatLink = screen.getByRole("link", { name: /Loose Chat/ });
    expect(chatLink.getAttribute("draggable")).toBe("false");

    const dataTransfer = makeDataTransfer("chat_1");
    fireEvent.dragStart(chatLink, { dataTransfer });
    expect(dataTransfer.setData).not.toHaveBeenCalled();

    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    fireEvent.drop(crewALink, { dataTransfer });
    expect(useCrewsModule.reparentAgent).not.toHaveBeenCalled();
  });

  it("refuses a drop whose dataTransfer claims a source no drag actually started", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    // No dragStart happened anywhere in this test — draggingId is still null.
    // A drop handler that trusted the dataTransfer's own claim would still
    // see a plausible, in-scope id here and reparent a thread that was never
    // picked up.
    const dataTransfer = makeDataTransfer("lead_a");
    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    fireEvent.drop(crewALink, { dataTransfer });
    expect(useCrewsModule.reparentAgent).not.toHaveBeenCalled();
  });

  it("ends the drag before Escape leaves edit mode", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    fireEvent.dragStart(crewALink, { dataTransfer: makeDataTransfer("cmd_a") });

    fireEvent.keyDown(window, { key: "Escape" });

    // Back to neutral: both crews offer their Rearrange affordance again.
    editCrew("Crew B");

    // If Escape had left the previous drag active, Crew B's gaps would render
    // "armed" from a drag that no one is still holding.
    expect(document.querySelectorAll(".relative.-my-1").length).toBe(0);
  });

  it("ends the drag before Done leaves edit mode", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    fireEvent.dragStart(crewALink, { dataTransfer: makeDataTransfer("cmd_a") });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    editCrew("Crew B");

    expect(document.querySelectorAll(".relative.-my-1").length).toBe(0);
  });
});
