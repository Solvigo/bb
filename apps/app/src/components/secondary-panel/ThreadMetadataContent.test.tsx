// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Environment, Thread } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { EnvironmentRow, ParentSelectorRow } from "./ThreadMetadataContent";
import { parentThreads } from "./ThreadMetadataContent.fixtures";

const localHost = { locality: "local", identity: null } as const;

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    providerId: "codex",
    title: null,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env_test",
    name: null,
    projectId: "proj_test",
    hostId: "host_test",
    path: "/workspace",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "feature",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: null,
    status: "ready",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function renderEnvironmentRow(environment: Environment): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <EnvironmentRow
        thread={makeThread({ environmentId: environment.id })}
        environment={environment}
        environmentDisplayHost={localHost}
      />
    </MemoryRouter>,
  );
}

describe("EnvironmentRow", () => {
  it("shows the create-thread action for a provisioned worktree", () => {
    expect(renderEnvironmentRow(makeEnvironment())).toContain(
      'aria-label="Create new thread in this worktree"',
    );
  });

  it("hides the create-thread action while a managed worktree is provisioning", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        status: "provisioning",
        path: null,
        isWorktree: false,
      }),
    );

    expect(markup).not.toContain(
      'aria-label="Create new thread in this worktree"',
    );
  });

  it("hides the create-thread action before a prepared worktree has a path", () => {
    const markup = renderEnvironmentRow(
      makeEnvironment({
        path: null,
        isWorktree: false,
      }),
    );

    expect(markup).not.toContain(
      'aria-label="Create new thread in this worktree"',
    );
  });
});

// A row with a parent carries two controls: the selector trigger and the clear
// button beside it. The trigger is the unlabelled one — named by the parent it
// is showing, which is the thing these cases vary.
function parentSelectorTrigger(): HTMLElement {
  const trigger = screen
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-label") !== "Clear parent thread");
  if (!trigger) throw new Error("no parent-selector trigger rendered");
  return trigger;
}

// The row hides itself for a thread with no parent — a pilot never has one, so
// showing an empty Parent line on every root thread was noise. These cases are
// about the MENU's behaviour, so they need a thread that still shows the row.
describe("ParentSelectorRow", () => {
  it("requests candidates only when the parent menu opens", async () => {
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter>
        <ParentSelectorRow
          thread={makeThread({ environmentId: null, parentThreadId: "thr_parent" })}
          projectId="proj_test"
          parentThreadDisplayName={null}
          parentThreads={[]}
          canAssignToParent
          canTakeOverThread={false}
          isLoadingParentThreads
          isParentThreadsError={false}
          updateThreadPending={false}
          onAssignParent={vi.fn()}
          onParentSelectorOpenChange={onOpenChange}
          onRetryParentThreads={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(parentSelectorTrigger(), {
      button: 0,
      ctrlKey: false,
    });

    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Loading threads…")).toBeTruthy();
  });

  it("offers a retry after candidate loading fails and shows recovered results", async () => {
    const onRetry = vi.fn();
    const row = (isError: boolean, candidates = parentThreads) => (
      <MemoryRouter>
        <ParentSelectorRow
          thread={makeThread({ environmentId: null, parentThreadId: "thr_parent" })}
          projectId="proj_test"
          parentThreadDisplayName={null}
          parentThreads={candidates}
          canAssignToParent
          canTakeOverThread={false}
          isLoadingParentThreads={false}
          isParentThreadsError={isError}
          updateThreadPending={false}
          onAssignParent={vi.fn()}
          onParentSelectorOpenChange={vi.fn()}
          onRetryParentThreads={onRetry}
        />
      </MemoryRouter>
    );
    const result = render(row(true, []));

    fireEvent.pointerDown(parentSelectorTrigger(), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText("Retry loading threads"));
    expect(onRetry).toHaveBeenCalledTimes(1);

    result.rerender(row(false));
    const trigger = screen
      .getAllByRole("button")
      .reverse()
      .find((candidate) => candidate.getAttribute("aria-haspopup") === "menu");
    if (!trigger) {
      throw new Error("missing parent selector trigger");
    }
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByText("Codex Parent")).toBeTruthy();
  });
});
