// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewProjectButton } from "./NewProjectButton";
import type { QuickCreateProjectController } from "@/hooks/useQuickCreateProject";

function makeController(
  overrides: Partial<QuickCreateProjectController> = {},
): QuickCreateProjectController {
  return {
    isAvailable: true,
    isCreating: false,
    openCreateDialog: vi.fn(),
    platform: null,
    hostId: null,
    hostName: null,
    hosts: [],
    projectPathDialog: {
      isOpen: false,
      onOpenChange: vi.fn(),
      target: null,
    },
    submitProjectPath: vi.fn(),
    ...overrides,
  };
}

describe("New project", () => {
  afterEach(cleanup);

  it("opens the project path dialog when pressed", () => {
    const quickCreateProject = makeController();
    render(<NewProjectButton quickCreateProject={quickCreateProject} />);
    fireEvent.click(screen.getByTestId("new-project-button"));
    expect(quickCreateProject.openCreateDialog).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when project creation is unavailable", () => {
    const quickCreateProject = makeController({ isAvailable: false });
    render(<NewProjectButton quickCreateProject={quickCreateProject} />);
    expect(screen.queryByTestId("new-project-button")).toBeNull();
  });
});
