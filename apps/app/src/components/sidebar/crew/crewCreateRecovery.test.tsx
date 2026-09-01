// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const createCrew = vi.fn();
const useCreateCrewMock = vi.hoisted(() =>
  vi.fn(() => ({
    createCrew,
    creating: false,
    creatingFor: () => false,
    error: null as string | null,
    lastAttempt: null as { projectId: string; openingRequest?: string } | null,
  })),
);

vi.mock("./useCreateCrew", () => ({
  useCreateCrew: useCreateCrewMock,
}));

import { CrewCreateRecovery } from "./crewCreateRecovery";

describe("CrewCreateRecovery", () => {
  afterEach(() => {
    cleanup();
    createCrew.mockClear();
    useCreateCrewMock.mockReturnValue({
      createCrew,
      creating: false,
      creatingFor: () => false,
      error: null,
      lastAttempt: null,
    });
  });

  it("keeps the failure alert and named retry in the DOM at a narrow layout width", () => {
    useCreateCrewMock.mockReturnValue({
      createCrew,
      creating: false,
      creatingFor: () => false,
      error: "The opening message could not be delivered in time. Try again.",
      lastAttempt: { projectId: "proj_a", openingRequest: "ship it" },
    });

    render(
      <div style={{ width: 390 }}>
        <CrewCreateRecovery />
      </div>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("in time");
    expect(
      screen.getByRole("button", {
        name: "Retry the unfinished crew setup",
      }),
    ).toBeTruthy();
  });

  it("restores focus to the recovery surface after a failed retry", async () => {
    const { rerender } = render(<CrewCreateRecovery />);

    useCreateCrewMock.mockReturnValue({
      createCrew,
      creating: true,
      creatingFor: () => true,
      error: null,
      lastAttempt: { projectId: "proj_a" },
    });
    rerender(<CrewCreateRecovery />);

    useCreateCrewMock.mockReturnValue({
      createCrew,
      creating: false,
      creatingFor: () => false,
      error: "The rig stopped answering while the crew was being created.",
      lastAttempt: { projectId: "proj_a" },
    });
    await act(async () => {
      rerender(<CrewCreateRecovery />);
    });

    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute(
        "data-testid",
        "crew-create-recovery",
      );
    });
  });
});
