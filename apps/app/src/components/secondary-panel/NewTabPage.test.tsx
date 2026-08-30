// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTabPage, type NewTabPageProps } from "./NewTabPage";

vi.mock("./NewTabFileSearch", () => ({
  NewTabFileSearch: () => <div data-testid="new-tab-file-search" />,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => null,
}));

afterEach(cleanup);

function renderPage({
  surfaces,
  onOpenSurface,
}: {
  surfaces?: NewTabPageProps["surfaces"];
  onOpenSurface?: NewTabPageProps["onOpenSurface"];
} = {}) {
  return render(
    <NewTabPage
      currentThreadId="thr_1"
      environmentId="env_1"
      focusRequest={0}
      onSelect={() => undefined}
      onOpenBrowser={() => undefined}
      onOpenReview={() => undefined}
      onOpenSurface={onOpenSurface}
      onStartTerminal={() => undefined}
      surfaces={surfaces}
      pluginActions={[
        {
          id: "tower",
          pluginId: "crew",
          icon: null,
          title: "Tower",
          onSelect: () => undefined,
        },
        {
          id: "side-chat",
          pluginId: "side-chat",
          icon: "SideChat",
          title: "Start side chat",
          onSelect: () => undefined,
        },
      ]}
      projectId="proj_1"
    />,
  );
}

describe("NewTabPage", () => {
  it("opens on the centered built-in tool launcher offering registered plugins", () => {
    const { container } = renderPage();

    expect(container.firstElementChild?.classList.contains("bg-tower-surface")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Browser" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Side chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tower" })).toBeTruthy();
    expect(screen.queryByTestId("new-tab-file-search")).toBeNull();
  });

  it("opens file search from the Files launcher row", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Files" }));

    expect(screen.getByTestId("new-tab-file-search")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All tools" })).toBeTruthy();
  });

  it("gives the agent's own Files action a programmatic group distinct from the identically-named row above it", () => {
    const onOpenSurface = vi.fn();
    renderPage({
      surfaces: [{ id: "files", label: "Files", icon: "Folder" }],
      onOpenSurface,
    });

    // Two "Files" buttons now exist on the page — the file-search launcher
    // above, and this agent's own Files surface — with no way to tell them
    // apart from their accessible name alone.
    expect(screen.getAllByRole("button", { name: "Files" })).toHaveLength(2);

    const agentGroup = screen.getByRole("group", { name: "This agent" });
    const agentFilesButton = within(agentGroup).getByRole("button", {
      name: "Files",
    });

    fireEvent.click(agentFilesButton);
    expect(onOpenSurface).toHaveBeenCalledWith("files");
    // The launcher-row Files button (outside the group) never fired the
    // agent-surface handler.
    expect(screen.queryByTestId("new-tab-file-search")).toBeNull();
  });
});
