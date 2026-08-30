// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectPathDialog } from "./ProjectPathDialog";

vi.mock("@/components/dialogs/RemotePathBrowser", () => ({
  RemotePathBrowser: ({
    hostId,
    allowCreateFolder,
    onDirectoryChange,
  }: {
    hostId: string;
    allowCreateFolder: boolean;
    onDirectoryChange: (directory: string) => void;
  }) => (
    <button
      type="button"
      data-allow-create-folder={String(allowCreateFolder)}
      onClick={() =>
        onDirectoryChange(
          hostId === "host_kunst"
            ? "/Users/amadad/projects/reachy_mini"
            : hostId === "host_long"
              ? `/home/deploy/repos/${"long-project-name-".repeat(20)}`
              : "/home/deploy/repos/givecare",
        )
      }
    >
      Choose folder on {hostId}
    </button>
  ),
}));

function host(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const atum = host({ id: "host_atum", name: "atum" });
const kunst = host({ id: "host_kunst", name: "Kunst" });
const longNameHost = host({ id: "host_long", name: "Long name host" });
const offline = host({
  id: "host_offline",
  name: "Offline Mac",
  status: "disconnected",
});
const offlineKunst = host({ ...kunst, status: "disconnected" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectPathDialog machine selection", () => {
  it("creates a project from a folder on the selected connected machine", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum, kunst, offline]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Machine" });
    expect(trigger.textContent).toContain("atum");
    expect(
      screen
        .getByRole("button", { name: "Choose folder on host_atum" })
        .getAttribute("data-allow-create-folder"),
    ).toBe("true");

    fireEvent.pointerDown(trigger, { button: 0 });
    expect(
      screen
        .getByRole("menuitem", { name: /Offline Mac/u })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: /Kunst/u }));
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_kunst" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "create" },
      "/Users/amadad/projects/reachy_mini",
      "host_kunst",
    );
  });

  it("preserves the direct single-machine folder flow", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole("button", { name: "Machine" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_atum" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "create" },
      "/home/deploy/repos/givecare",
      "host_atum",
    );
  });

  it("names the folder it will act on, not just the project name it derives", () => {
    // Two sibling checkouts derive the same project name, so "Project name:
    // givecare" confirmed nothing about which one was chosen.
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("project-path-destination")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_atum" }),
    );
    expect(
      screen.getByTestId("project-path-destination").textContent,
    ).toContain("/home/deploy/repos/givecare");
  });

  it("says so in the dialog when the create itself is refused", () => {
    // The dialog is the only surface on screen. A refusal that never reaches
    // it leaves the button live again and nothing said.
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        submitError="That folder is already a project."
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId("project-path-submit-error").textContent).toBe(
      "That folder is already a project.",
    );
  });

  it("says it is working while the create is in flight", () => {
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        pending
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: "Adding project…" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Add project" })).toBeNull();
  });

  it("constrains long project names to the dialog width", () => {
    const longProjectName = "long-project-name-".repeat(20);
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={longNameHost.id}
        hostName={longNameHost.name}
        hosts={[longNameHost]}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_long" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("grid-cols-[minmax(0,1fr)]");
    expect(dialog.querySelector("form")?.className).toContain("min-w-0");

    const projectName = screen.getByText(longProjectName);
    expect(projectName.className).toContain("min-w-0");
    expect(projectName.className).toContain("truncate");
    expect(projectName.parentElement?.className).toContain("min-w-0");
  });

  // With machines listed but none selectable there is no host to resolve a
  // path against, so the manual-path fallback must not invite a submit that
  // the picker hook would drop without feedback.
  it("blocks submission when every listed machine is offline", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={null}
        hostName={null}
        hosts={[offline, offlineKunst]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByLabelText("Project path")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Add project" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
