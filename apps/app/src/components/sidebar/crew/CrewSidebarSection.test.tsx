// @vitest-environment jsdom


import { render, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CrewSidebarSection, CrewEditProvider } from "./CrewSidebarSection";
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
