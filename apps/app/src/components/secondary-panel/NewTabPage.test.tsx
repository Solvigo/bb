// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTabPage } from "./NewTabPage";

vi.mock("./NewTabFileSearch", () => ({
  NewTabFileSearch: () => <div data-testid="new-tab-file-search" />,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => null,
}));

afterEach(cleanup);

function renderPage() {
  return render(
    <NewTabPage
      currentThreadId="thr_1"
      environmentId="env_1"
      focusRequest={0}
      onSelect={() => undefined}
      onOpenBrowser={() => undefined}
      onOpenReview={() => undefined}
      onStartTerminal={() => undefined}
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
});
