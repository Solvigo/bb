// @vitest-environment jsdom

import { act, cleanup, render, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  ChatsSidebarSection,
  CrewSidebarSection,
  CrewEditProvider,
} from "./CrewSidebarSection";
import * as useCrewsModule from "./useCrews";
import * as queryHooks from "@/hooks/queries/sidebar-navigation-query";

// The real assembleFleet, unmocked below — vi.mock spreads `...actual` for
// everything it does not explicitly override.
const { assembleFleet } = useCrewsModule;

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

  // Raw thread/fleet rows, run through the REAL assembleFleet — not a
  // hand-built { crews, chats } shape — so the promotion tests exercise the
  // actual production classification: a normal crew-spawned lead keeps its
  // crew handle across a promotion, so it comes back as a new root CREW, not
  // a loose chat. Only chat_1/chat_2 carry no fleet row, which is what
  // actually makes something a loose chat.
  const THREADS_BASE = [
    { id: "cmd_a", title: "Crew A", projectId: "p1", parentThreadId: null },
    { id: "lead_a", title: "Lead A", projectId: "p1", parentThreadId: "cmd_a" },
    { id: "cmd_b", title: "Crew B", projectId: "p2", parentThreadId: null },
    { id: "lead_b", title: "Lead B", projectId: "p2", parentThreadId: "cmd_b" },
    {
      id: "sortie_b",
      title: "Sortie B",
      projectId: "p2",
      parentThreadId: "lead_b",
    },
    { id: "chat_1", title: "Loose Chat", projectId: "p1", parentThreadId: null },
    {
      id: "chat_2",
      title: "Other Project Chat",
      projectId: "p2",
      parentThreadId: null,
    },
  ];

  const FLEET_ROWS_BASE = [
    { threadId: "cmd_a", handle: "Crew A", rank: "commander" },
    { threadId: "lead_a", handle: "Lead A", rank: "lead" },
    { threadId: "cmd_b", handle: "Crew B", rank: "commander" },
    { threadId: "lead_b", handle: "Lead B", rank: "lead" },
    { threadId: "sortie_b", handle: "Sortie B", rank: "sortie" },
  ];

  function assembledBase() {
    return assembleFleet(THREADS_BASE, { rows: FLEET_ROWS_BASE }, null, null, null);
  }

  // Promotes ONE thread to root — a normal make-root move — leaving every
  // other relationship and every fleet handle untouched, and re-derives the
  // real crews/chats through assembleFleet rather than hand-editing them.
  function assembledAfterPromoting(threadId: string) {
    const threads = THREADS_BASE.map((t) =>
      t.id === threadId ? { ...t, parentThreadId: null } : t,
    );
    return assembleFleet(threads, { rows: FLEET_ROWS_BASE }, null, null, null);
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

  it("classifies a promoted crew-spawned leaf as a new root crew, not a loose chat", () => {
    // The actual production shape, proven against the real assembleFleet
    // rather than assumed: a normal lead keeps its crew handle across a
    // promotion, so a root with a handle and no leads is still a CREW.
    const before = assembledBase();
    expect(before.crews.map((c) => c.commanderThreadId)).toEqual([
      "cmd_a",
      "cmd_b",
    ]);

    const after = assembledAfterPromoting("lead_a");
    expect(after.crews.map((c) => c.commanderThreadId)).toEqual([
      "cmd_a",
      "lead_a",
      "cmd_b",
    ]);
    // The two handle-less chats are completely unaffected.
    expect(after.chats.map((c) => c.threadId)).toEqual(
      before.chats.map((c) => c.threadId),
    );
  });

  it("offers a move-menu recovery path on the leaf's real post-promotion shape (a new root crew)", async () => {
    const { rerender } = renderTwoCrewsAndAChat();
    editCrew("Crew A");

    // Promote Lead A to root via the ordinary per-agent menu — the same move
    // a drag-to-the-project-header would make.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make root" }));
    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith("lead_a", null);
    // Waiting for the announcement is waiting for the SAME state update that
    // publishes the recovery — both happen inside the same `.then()`.
    await screen.findByText("Moved to the top.");

    // The fleet catches up through the real assembleFleet: Lead A keeps its
    // crew handle, so it comes back as a brand new root CREW with no leads —
    // never a loose chat.
    const { crews, chats } = assembledAfterPromoting("lead_a");
    expect(crews.some((c) => c.commanderThreadId === "lead_a")).toBe(true);
    expect(chats.some((c) => c.threadId === "lead_a")).toBe(false);
    setFleet(crews, chats);
    rerender(renderTree());

    // Provenance-bound: this is the ONE crew that just left Crew A, so it —
    // and only it — gets a way back in, even rendered as an ordinary
    // out-of-scope CrewEntry rather than a ChatRow.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Crew A" }));
    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith(
      "lead_a",
      "cmd_a",
    );

    // The two loose chats that were never part of any promotion still have
    // no menu — the binding did not widen into "any loose chat", nor did it
    // start assuming every recovery lands as a chat.
    expect(
      screen.queryByRole("button", { name: "Move Loose Chat" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move Other Project Chat" }),
    ).toBeNull();
  });

  it("does not leak a promotion's recovery into a later edit session, even of the same crew", async () => {
    const { rerender } = renderTwoCrewsAndAChat();
    editCrew("Crew A");

    let resolvePromotion: (outcome: { ok: boolean }) => void = () => {};
    const pending = new Promise<{ ok: boolean }>((resolve) => {
      resolvePromotion = resolve;
    });
    vi.mocked(useCrewsModule.reparentAgent).mockReturnValueOnce(pending);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make root" }));

    // The fleet catches up with the real post-promotion shape WHILE the
    // reparent call is still pending — the next fetch and the network
    // answer to THIS call are two different things, and the fetch can win.
    const { crews, chats } = assembledAfterPromoting("lead_a");
    setFleet(crews, chats);
    rerender(renderTree());

    // Leave, then come back to the SAME crew before the promise resolves —
    // a genuinely new edit session, even though `fromCrewId` alone
    // ("cmd_a") would match either one.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    editCrew("Crew A");

    await act(async () => {
      resolvePromotion({ ok: true });
      await pending;
    });

    // Lead A's promoted crew is out of scope for THIS session regardless —
    // the only thing that could put a menu on it is a leaked recovery.
    expect(
      screen.queryByRole("button", { name: "Move Lead A" }),
    ).toBeNull();
  });

  it("does not leak a promotion's recovery when the operator switches to a different crew before it resolves", async () => {
    const { rerender } = renderTwoCrewsAndAChat();
    editCrew("Crew A");

    let resolvePromotion: (outcome: { ok: boolean }) => void = () => {};
    const pending = new Promise<{ ok: boolean }>((resolve) => {
      resolvePromotion = resolve;
    });
    vi.mocked(useCrewsModule.reparentAgent).mockReturnValueOnce(pending);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make root" }));

    const { crews, chats } = assembledAfterPromoting("lead_a");
    setFleet(crews, chats);
    rerender(renderTree());

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    editCrew("Crew B");

    await act(async () => {
      resolvePromotion({ ok: true });
      await pending;
    });

    expect(
      screen.queryByRole("button", { name: "Move Lead A" }),
    ).toBeNull();
  });

  it("keeps every leaf promoted this session independently recoverable, however they settle, and clears each on its own move back", async () => {
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([["p1", "Project 1"]]),
    );
    const threads = [
      { id: "cmd_a", title: "Crew A", projectId: "p1", parentThreadId: null },
      {
        id: "lead_a",
        title: "Lead A",
        projectId: "p1",
        parentThreadId: "cmd_a",
      },
      {
        id: "lead_a2",
        title: "Lead A2",
        projectId: "p1",
        parentThreadId: "cmd_a",
      },
    ];
    const fleetRows = [
      { threadId: "cmd_a", handle: "Crew A", rank: "commander" },
      { threadId: "lead_a", handle: "Lead A", rank: "lead" },
      { threadId: "lead_a2", handle: "Lead A2", rank: "lead" },
    ];
    setFleet(
      assembleFleet(threads, { rows: fleetRows }, null, null, null).crews,
      [],
    );
    const { rerender } = render(renderTree());
    editCrew("Crew A");

    let resolveFirst: (outcome: { ok: boolean }) => void = () => {};
    let resolveSecond: (outcome: { ok: boolean }) => void = () => {};
    const first = new Promise<{ ok: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<{ ok: boolean }>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(useCrewsModule.reparentAgent)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make root" }));

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Move Lead A2" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make root" }));

    // Resolve OUT OF ORDER: the SECOND call settles first.
    await act(async () => {
      resolveSecond({ ok: true });
      await second;
    });
    await act(async () => {
      resolveFirst({ ok: true });
      await first;
    });

    const threadsAfter = threads.map((t) =>
      t.id === "lead_a" || t.id === "lead_a2" ? { ...t, parentThreadId: null } : t,
    );
    setFleet(
      assembleFleet(threadsAfter, { rows: fleetRows }, null, null, null).crews,
      [],
    );
    rerender(renderTree());

    // Both are independently recoverable — a single "last one wins" slot
    // would have left whichever settled first (Lead A2) as a permanent,
    // one-way root the instant the SECOND promotion's own reply landed, with
    // nothing the operator did to it.
    expect(
      screen.queryByRole("button", { name: "Move Lead A" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move Lead A2" }),
    ).not.toBeNull();

    // Recover Lead A specifically.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Crew A" }));
    expect(useCrewsModule.reparentAgent).toHaveBeenCalledWith(
      "lead_a",
      "cmd_a",
    );

    // Lead A's own recovery clears; Lead A2's is untouched by it.
    await screen.findByText("Moved.");
    expect(screen.queryByRole("button", { name: "Move Lead A" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move Lead A2" }),
    ).not.toBeNull();
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

  it("revalidates the drop target against the CURRENT tree, catching a cycle the drag-time snapshot could not know about", () => {
    const crewAWithOneLead = {
      projectId: "p1",
      commanderThreadId: "cmd_a",
      name: "Crew A",
      status: "idle",
      liveness: null,
      attention: 0,
      leads: [
        {
          threadId: "lead_a1",
          name: "Lead A1",
          liveness: null,
          attention: 0,
          sorties: [],
        },
      ],
    };
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([["p1", "Project 1"]]),
    );
    setFleet([crewAWithOneLead], []);
    const { rerender } = render(renderTree());
    editCrew("Crew A");

    // Drag the commander itself — its subtree snapshot, taken now, is only
    // {cmd_a, lead_a1}.
    const crewALink = screen.getByRole("link", { name: /Crew A/ });
    const dataTransfer = makeDataTransfer("cmd_a");
    fireEvent.dragStart(crewALink, { dataTransfer });

    // The tree changes mid-drag: a second lead joins Crew A. The drag-time
    // snapshot has no way to know it exists, so the row-level isForbidden
    // check (built from that snapshot) will not flag a drop onto it.
    setFleet(
      [
        {
          ...crewAWithOneLead,
          leads: [
            ...crewAWithOneLead.leads,
            {
              threadId: "lead_a2",
              name: "Lead A2",
              liveness: null,
              attention: 0,
              sorties: [],
            },
          ],
        },
      ],
      [],
    );
    rerender(renderTree());

    const lead2Link = screen.getByRole("link", { name: /Lead A2/ });
    fireEvent.drop(lead2Link, { dataTransfer });

    // Dropping a commander under its own lead is a cycle regardless of when
    // that lead joined the branch — move() has to check the CURRENT tree,
    // not just the row's own (also current, but differently-derived)
    // isForbidden flag.
    expect(useCrewsModule.reparentAgent).not.toHaveBeenCalled();
  });

  it("renders no insertion gaps while editing with no drag in flight (neutral state)", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");
    expect(document.querySelectorAll(".relative.-my-1").length).toBe(0);
  });

  it("ends the drag when a drop lands in a gap, not just on a row or a project header", () => {
    renderTwoCrewsAndAChat();
    editCrew("Crew A");

    const leadALink = screen.getByRole("link", { name: /Lead A/ });
    const dataTransfer = makeDataTransfer("lead_a");
    fireEvent.dragStart(leadALink, { dataTransfer });

    const gaps = document.querySelectorAll(".relative.-my-1");
    expect(gaps.length).toBeGreaterThan(0);
    fireEvent.drop(gaps[0], { dataTransfer });

    // Back to neutral, then into a different crew: if the gap drop had left
    // draggingId set, Crew B's gaps would render "armed" from a drag no one
    // is still holding.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    editCrew("Crew B");
    expect(document.querySelectorAll(".relative.-my-1").length).toBe(0);
  });

  it("moves focus to Done when entering edit mode, since the clicked Rearrange button unmounts", () => {
    renderTwoCrewsAndAChat();

    const rearrangeButton = screen.getByRole("button", {
      name: "Rearrange Crew A",
    });
    rearrangeButton.focus();
    fireEvent.click(rearrangeButton);

    // The button focus was just on no longer exists — editingCrewId !== null
    // hides every Rearrange button — so the browser would otherwise drop
    // focus to the document body.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Done" }),
    );
  });

  it("restores focus to that crew's own Rearrange control when Done leaves edit mode", () => {
    renderTwoCrewsAndAChat();
    fireEvent.click(
      screen.getByRole("button", { name: "Rearrange Crew A" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // Done just unmounted; the remounted button has to be the SAME crew's,
    // not merely some focusable element.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Rearrange Crew A" }),
    );
  });

  it("restores focus to that crew's own Rearrange control when Escape leaves edit mode", () => {
    renderTwoCrewsAndAChat();
    fireEvent.click(
      screen.getByRole("button", { name: "Rearrange Crew A" }),
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Rearrange Crew A" }),
    );
  });

  it("does not let a stale recovery-completion erase a re-promotion of the SAME thread that settled first", async () => {
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([["p1", "Project 1"]]),
    );
    const threads = [
      { id: "cmd_a", title: "Crew A", projectId: "p1", parentThreadId: null },
      {
        id: "lead_a",
        title: "Lead A",
        projectId: "p1",
        parentThreadId: "cmd_a",
      },
    ];
    const fleetRows = [
      { threadId: "cmd_a", handle: "Crew A", rank: "commander" },
      { threadId: "lead_a", handle: "Lead A", rank: "lead" },
    ];
    const assembled = (parentOfLeadA: string | null) =>
      assembleFleet(
        threads.map((t) =>
          t.id === "lead_a" ? { ...t, parentThreadId: parentOfLeadA } : t,
        ),
        { rows: fleetRows },
        null,
        null,
        null,
      );

    setFleet(assembled("cmd_a").crews, []);
    const { rerender } = render(renderTree());
    editCrew("Crew A");

    // The FIRST promotion: Lead A leaves Crew A and becomes recoverable.
    // Resolves normally via the default mock.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make root" }));
    await screen.findByText("Moved to the top.");

    setFleet(assembled(null).crews, []);
    rerender(renderTree());
    expect(
      screen.queryByRole("button", { name: "Move Lead A" }),
    ).not.toBeNull();

    // R1: recover it back into Crew A. Held pending.
    let resolveR1: (outcome: { ok: boolean }) => void = () => {};
    const r1 = new Promise<{ ok: boolean }>((resolve) => {
      resolveR1 = resolve;
    });
    vi.mocked(useCrewsModule.reparentAgent).mockReturnValueOnce(r1);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Crew A" }));

    // An optimistic refresh shows Lead A back under Crew A before R1's own
    // network reply lands — exactly what the real reparentAgent's own
    // pendingParents bookkeeping does while a call is in flight.
    setFleet(assembled("cmd_a").crews, []);
    rerender(renderTree());

    // P2: re-promote the SAME thread from its (optimistic) normal position.
    let resolveP2: (outcome: { ok: boolean }) => void = () => {};
    const p2 = new Promise<{ ok: boolean }>((resolve) => {
      resolveP2 = resolve;
    });
    vi.mocked(useCrewsModule.reparentAgent).mockReturnValueOnce(p2);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Move Lead A" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make root" }));

    // P2 settles FIRST.
    await act(async () => {
      resolveP2({ ok: true });
      await p2;
    });
    setFleet(assembled(null).crews, []);
    rerender(renderTree());
    expect(
      screen.queryByRole("button", { name: "Move Lead A" }),
    ).not.toBeNull();

    // The STALE R1 settles LAST.
    await act(async () => {
      resolveR1({ ok: true });
      await r1;
    });

    // R1's stale "it moved back in" must not erase P2's fresher "it left
    // again" — a per-thread generation, not just the edit-session one, has
    // to gate which settlement wins.
    expect(
      screen.queryByRole("button", { name: "Move Lead A" }),
    ).not.toBeNull();
  });

  it("falls back to the Projects section when the edited crew disappears before Done can find its Rearrange control", () => {
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([["p1", "Project 1"]]),
    );
    setFleet(
      [
        {
          projectId: "p1",
          commanderThreadId: "cmd_a",
          name: "Crew A",
          status: "idle",
          liveness: null,
          attention: 0,
          leads: [],
        },
      ],
      [],
    );
    const { rerender } = render(renderTree());
    editCrew("Crew A");

    // The crew disappears entirely while it is being edited — e.g. deleted,
    // or reclassified under a different commander thread id — so there is no
    // "Rearrange Crew A" button left to remount when Done is pressed.
    setFleet([], []);
    rerender(renderTree());

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // Not the document body, and not an unnamed generic div: a real,
    // labelled heading — the one thing in the section guaranteed to still
    // exist — pulled out of ordinary Tab order on purpose.
    const projectsHeading = screen.getByRole("heading", {
      name: "Projects",
      level: 2,
    });
    expect(document.activeElement).toBe(projectsHeading);
    expect(projectsHeading.getAttribute("tabindex")).toBe("-1");
  });

  it("falls back to the Projects section when the edited crew disappears before Escape can find its Rearrange control", () => {
    vi.mocked(queryHooks.useProjectNames).mockReturnValue(
      new Map([["p1", "Project 1"]]),
    );
    setFleet(
      [
        {
          projectId: "p1",
          commanderThreadId: "cmd_a",
          name: "Crew A",
          status: "idle",
          liveness: null,
          attention: 0,
          leads: [],
        },
      ],
      [],
    );
    const { rerender } = render(renderTree());
    editCrew("Crew A");

    setFleet([], []);
    rerender(renderTree());

    fireEvent.keyDown(window, { key: "Escape" });

    const projectsHeading = screen.getByRole("heading", {
      name: "Projects",
      level: 2,
    });
    expect(document.activeElement).toBe(projectsHeading);
    expect(projectsHeading.getAttribute("tabindex")).toBe("-1");
  });
});
