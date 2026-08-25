// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const createCrew = vi.fn();

vi.mock("./useCreateCrew", () => ({
  useCreateCrew: () => ({ createCrew, creating: false, error: null }),
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
vi.mock("@/components/secondary-panel/tower/RankInsignia", () => ({
  PlatedInsignia: () => null,
}));

import { NewCrewButton } from "./NewCrewButton";

describe("New crew", () => {
  // Each case renders the button again; without this they stack and every
  // query finds two of everything.
  afterEach(cleanup);

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

  it("never offers the personal project by name — it is the fallback, not a choice", async () => {
    render(<NewCrewButton />);
    fireEvent.pointerDown(screen.getByTestId("new-crew-button"), { button: 0 });
    await screen.findByRole("menuitem", { name: /No code yet/i });
    expect(screen.queryByRole("menuitem", { name: "Personal" })).toBeNull();
  });
});
