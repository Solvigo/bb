// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const createCrew = vi.fn();
const crews = vi.hoisted(() => ({
  value: [] as { projectId: string }[],
}));

vi.mock("./useCreateCrew", () => ({
  useCreateCrew: () => ({
    createCrew,
    creating: false,
    creatingFor: () => false,
    error: null,
  }),
}));
vi.mock("./useCrews", () => ({
  useCrews: () => ({
    crews: crews.value,
    chats: [],
    pendingRoots: [],
    loaded: true,
    failed: false,
    timedOut: false,
    reload: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      projects: [
        { id: "proj_personal", name: "Personal" },
        { id: "proj_airways", name: "Solvigo Airways — bb" },
      ],
    },
  }),
}));
import { NewCrewButton } from "./NewCrewButton";

describe("New crew", () => {
  // Each case renders the button again; without this they stack and every
  // query finds two of everything.
  afterEach(() => {
    cleanup();
    crews.value = [];
  });

  it("asks which project the crew is for, and hands that project to the creator", async () => {
    // A commander is created ON a project and can never move, so choosing later
    // is not an option — one made in the wrong place can talk but never
    // dispatch. The button therefore has to ask, once, here.
    render(<NewCrewButton />);
    fireEvent.pointerDown(screen.getByTestId("new-crew-button"), { button: 0 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Solvigo Airways — bb" }),
    );
    expect(createCrew).toHaveBeenCalledWith("proj_airways");
  });

  it("offers 'no code yet' as a real answer and passes no project for it", async () => {
    createCrew.mockClear();
    render(<NewCrewButton />);
    fireEvent.pointerDown(screen.getByTestId("new-crew-button"), { button: 0 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /No code yet/i }),
    );
    // No project named: the caller falls back to Personal, which is the one
    // case the fast repo-less commander was built for.
    expect(createCrew).toHaveBeenCalledWith();
  });

  it("does not offer a project that already owns a crew", async () => {
    // A project holds one crew, so offering a crewed one is offering a press
    // that can only end in a refusal — and, before the fleet was consulted
    // first, in a loose standby left behind by the attempt.
    crews.value = [{ projectId: "proj_airways" }];
    render(<NewCrewButton />);
    fireEvent.pointerDown(screen.getByTestId("new-crew-button"), { button: 0 });
    await screen.findByRole("menuitem", { name: /No code yet/i });
    expect(
      screen.queryByRole("menuitem", { name: "Solvigo Airways — bb" }),
    ).toBeNull();
  });

  it("never offers the personal project by name — it is the fallback, not a choice", async () => {
    render(<NewCrewButton />);
    fireEvent.pointerDown(screen.getByTestId("new-crew-button"), { button: 0 });
    await screen.findByRole("menuitem", { name: /No code yet/i });
    expect(screen.queryByRole("menuitem", { name: "Personal" })).toBeNull();
  });
});
