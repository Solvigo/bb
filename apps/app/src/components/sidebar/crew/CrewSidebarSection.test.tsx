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

  // Crew B lives in a SECOND project on purpose: the make-root scoping tests
  // need two distinct project headers, and every other test in this suite
  // treats Crew B purely as "the crew not being edited" regardless of which
  // project it is in. Project 3 has no crew at all — the empty-project
  // Add-a-crew coverage needs one that exists but is never the edited one.
  function baseCrews() {
    return [
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
  }

  // Two PRE-EXISTING loose chats, one in each of Crew A/B's projects, neither
  // ever promoted from anything. The recovery-menu tests need both, to prove
  // the menu is bound to a specific promoted thread rather than to "any loose
  // chat in the same (or any) project".
  function baseChats() {
    return [
      {
        threadId: "chat_1",
        name: "Loose Chat",
        projectId: "p1",
        liveness: null,
      },
      {
        threadId: "chat_2",
        name: "Other Project Chat",
        projectId: "p2",
        liveness: null,
      },
    ];
  }

  function setFleet(crews: unknown[], chats: unknown[]) {
    vi.mocked(useCrewsModule.useCrews).mockReturnValue({
      crews,
      chats,
      loaded: true,
      failed: false,
      timedOut: false,
      reload: vi.fn(),
    } as any);
  }

  function renderTree(onNavigate?: () => void) {
    return (
      <MemoryRouter>
        <CrewEditProvider>
          <CrewSidebarSection onNavigate={onNavigate} />
          <ChatsSidebarSection onNavigate={onNavigate} />
        </CrewEditProvider>
      </MemoryRouter>
    );
  }

  function renderTwoCrewsAndAChat(onNavigate?: () => void) {
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([
        ["p1", "Project 1"],
        ["p2", "Project 2"],
        ["p3", "Project 3"],
      ]),
    );
    setFleet(baseCrews(), baseChats());
    return render(renderTree(onNavigate));
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

    // A real <button>, so it goes `disabled` rather than tabIndex={-1} — the
    // stronger, native guarantee that a click cannot reach its handler at all.
    const leadBExpandButton = screen.getByRole("button", {
      name: "Show the agents under Lead B",
    }) as HTMLButtonElement;
    expect(leadBExpandButton.disabled).toBe(true);

    // A loose chat is dimmed for every crew's edit, not only a foreign one.
    const chatLink = screen.getByRole("link", { name: /Loose Chat/ });
    expect(chatLink.getAttribute("tabindex")).toBe("-1");
  });

  it("does not offer the move menu to a pre-existing loose chat, same project or not", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    // Nothing has been promoted in this test, so there is no recovery
    // binding — neither chat has any affiliation with Crew A, whether it
    // lives in Crew A's own project or a different one.
    expect(
      screen.queryByRole("button", { name: "Move Loose Chat" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move Other Project Chat" }),
    ).toBeNull();
  });

  it("offers a move-menu recovery path only for the leaf just promoted out of the edited crew", async () => {
    const { rerender } = renderTwoCrewsAndAChat();
    editCrew("Crew A");

    // Promote Lead A to root via the ordinary per-agent menu — the same move
    // a drag-to-the-project-header would make.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make root" }));
    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith("lead_a", null);

    // The fleet catches up: Crew A no longer has Lead A, and it now shows up
    // as a loose chat alongside the two that were always there.
    const [crewA, crewB] = baseCrews();
    setFleet(
      [{ ...crewA, leads: [] }, crewB],
      [
        ...baseChats(),
        { threadId: "lead_a", name: "Lead A", projectId: "p1", liveness: null },
      ],
    );
    rerender(renderTree());

    // Provenance-bound: this is the ONE loose chat that just left Crew A, so
    // it — and only it — gets a way back in.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Crew A" }));
    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith(
      "lead_a",
      "cmd_a",
    );

    // The two loose chats that were never part of any promotion still have
    // no menu — the binding did not widen into "any loose chat".
    expect(
      screen.queryByRole("button", { name: "Move Loose Chat" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move Other Project Chat" }),
    ).toBeNull();
  });

  it("rejects a drop whose source is no longer part of the edited crew after a fleet refresh", () => {
    const { rerender } = renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const leadALink = screen.getByRole("link", { name: /Lead A/ });
    const dataTransfer = makeDataTransfer("lead_a");
    fireEvent.dragStart(leadALink, { dataTransfer });

    // The fleet refreshes mid-drag: something else reparented Lead A out from
    // under Crew A before the drop lands. draggingId and the dataTransfer
    // both still say "lead_a" — only a fresh read of current membership,
    // taken at move time, catches that it is no longer true.
    const [crewA, crewB] = baseCrews();
    setFleet([{ ...crewA, leads: [] }, crewB], baseChats());
    rerender(renderTree());

    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    fireEvent.drop(crewALink, { dataTransfer });
    expect(useCrewsModule.reparentAgent).not.toHaveBeenCalled();
  });

  it("keeps out-of-scope elements inert even when a click reaches them directly", () => {
    const onNavigate = vi.fn();
    renderTwoCrewsAndAChat(onNavigate);
    editCrew("Crew A");

    // pointer-events-none on the dimmed ancestor only ever stopped a real
    // mouse; a click dispatched straight at the element — standing in for
    // retained or programmatic focus plus a keyboard activation — must still
    // do nothing.
    fireEvent.click(screen.getByRole("link", { name: /Crew B/ }));
    fireEvent.click(screen.getByRole("link", { name: /Lead B/ }));
    fireEvent.click(screen.getByRole("link", { name: /Loose Chat/ }));
    expect(onNavigate).not.toHaveBeenCalled();

    const leadBExpandButton = screen.getByRole("button", {
      name: "Show the agents under Lead B",
    }) as HTMLButtonElement;
    fireEvent.click(leadBExpandButton);
    // A disabled toggle does not toggle: Sortie B never becomes reachable.
    expect(screen.queryByRole("link", { name: /Sortie B/ })).toBeNull();
  });

  it("disables Add a crew for an empty project while a different crew is being edited", () => {
    renderTwoCrewsAndAChat();

    // Project 3 is the only empty one, so this is unambiguous.
    const addCrewButton = screen.getByRole("button", {
      name: "Add a crew",
    }) as HTMLButtonElement;
    expect(addCrewButton.disabled).toBe(false);

    editCrew("Crew A");
    expect(addCrewButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(addCrewButton.disabled).toBe(false);
  });
});
