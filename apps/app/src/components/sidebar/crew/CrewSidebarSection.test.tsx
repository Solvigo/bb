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
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([["p1", "Project 1"]]),
    );

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
      </MemoryRouter>,
    );

    // Expand edit mode by clicking edit on root
    const editBtn = screen.getByRole("button", { name: "Rearrange Root Crew" });
    fireEvent.click(editBtn);

    // Expand the child lead so we can see its gaps
    const expandBtn = screen.getByRole("button", {
      name: "Show the agents under Child Lead",
    });
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
    // Crew B lives in a SECOND project on purpose: the make-root scoping
    // tests need two distinct project headers, and every other test in this
    // suite treats Crew B purely as "the crew not being edited" regardless of
    // which project it is in.
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([
        ["p1", "Project 1"],
        ["p2", "Project 2"],
      ]),
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
        projectId: "p2",
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
            // A child of its own, so a test can reach Lead B's expand/collapse
            // toggle — the "other-crew expansion button" keyboard-isolation
            // coverage needs one to exist while Crew B is out of scope.
            sorties: [
              {
                threadId: "sortie_b",
                name: "Sortie B",
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

  it("allows dropping an agent directly under its own crew's commander", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    // Lead A's own commander is the one target every earlier "out of scope"
    // check would also reject if the commander row read its own scope wrong
    // — this is the positive case those checks must not have broken.
    const leadALink = screen.getByRole("link", { name: /Lead A/ });
    const dataTransfer = makeDataTransfer("lead_a");
    fireEvent.dragStart(leadALink, { dataTransfer });

    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    fireEvent.dragOver(crewALink, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");

    fireEvent.drop(crewALink, { dataTransfer });
    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith(
      "lead_a",
      "cmd_a",
    );
  });

  it("restricts the make-root drop to the edited crew's own project header", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    const dataTransfer = makeDataTransfer("cmd_a");
    fireEvent.dragStart(crewALink, { dataTransfer });

    // Crew A lives in Project 1. reparentAgent takes no project, so Project
    // 2's header would perform the identical "make root" — but offering it
    // there implies something the drop cannot actually do.
    const otherProjectHeader = screen.getByText("Project 2");
    fireEvent.dragOver(otherProjectHeader, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("none");
    expect(otherProjectHeader.closest("div")?.className).toContain(
      "pointer-events-none",
    );

    fireEvent.drop(otherProjectHeader, { dataTransfer });
    expect(useCrewsModule.reparentAgent).not.toHaveBeenCalled();

    // A drop — refused or not — ends the drag, so the positive case needs a
    // fresh one.
    fireEvent.dragStart(crewALink, { dataTransfer });
    const ownProjectHeader = screen.getByText("Project 1");
    fireEvent.dragOver(ownProjectHeader, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");

    fireEvent.drop(ownProjectHeader, { dataTransfer });
    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith("cmd_a", null);
  });

  it("pulls out-of-scope interactive elements out of the tab order, not just out of pointer reach", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    // In scope: Crew A's own lead stays reachable.
    const leadALink = screen.getByRole("link", { name: /Lead A/ });
    expect(leadALink.getAttribute("tabindex")).not.toBe("-1");

    // Out of scope: Crew B's lead and its own expand/collapse toggle are both
    // dimmed by the same ancestor's pointer-events-none, which Tab ignores.
    const leadBLink = screen.getByRole("link", { name: /Lead B/ });
    expect(leadBLink.getAttribute("tabindex")).toBe("-1");

    const leadBExpandButton = screen.getByRole("button", {
      name: "Show the agents under Lead B",
    });
    expect(leadBExpandButton.getAttribute("tabindex")).toBe("-1");

    // A loose chat is dimmed for every crew's edit, not only a foreign one.
    const chatLink = screen.getByRole("link", { name: /Loose Chat/ });
    expect(chatLink.getAttribute("tabindex")).toBe("-1");
  });

  it("offers a move-menu recovery path for a loose chat while a crew is being edited", async () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    // Promoting a leaf to root is what turns it into a row exactly like this
    // one; drag stays closed off for a loose chat, so the recovery back into
    // the crew being edited has to be this menu, not a dataTransfer.
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Move Loose Chat" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Lead A" }));

    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith(
      "chat_1",
      "lead_a",
    );
  });
});
