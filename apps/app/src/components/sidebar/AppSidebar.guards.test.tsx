// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { AppSidebar } from "./AppSidebar";

function makeController(
  overrides: Partial<QuickCreateProjectController> = {},
): QuickCreateProjectController {
  return {
    isAvailable: true,
    isCreating: false,
    createError: null,
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

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: () => {},
  useAppCommandShortcut: () => undefined,
  useAppCommandShortcuts: () => new Map(),
  useIndexedAppCommandHandlers: () => {},
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ threadId: null }),
}));

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
}));

vi.mock("@bb/shared-ui/hooks/use-pointer-coarse", () => ({
  usePointerCoarse: () => false,
}));

vi.mock("@/lib/bb-desktop", () => ({
  CHROME_ROW_CLASS: "",
  MACOS_WINDOW_DRAG_CLASS: "",
  MACOS_WINDOW_NO_DRAG_CLASS: "",
  getBbDesktopInfo: () => null,
  shouldUseMacosDesktopChrome: () => false,
}));

vi.mock("./threadListProvider", () => ({
  useThreadListProvider: () => null,
}));

vi.mock("./useSidebarThreadSearch", () => ({
  useSidebarThreadSearch: () => ({
    activeIndex: 0,
    activeDescendantId: null,
    inputRef: { current: null },
    isActive: false,
    onActivate: vi.fn(),
    onActiveIndexChange: vi.fn(),
    onClose: vi.fn(),
    onExternalThreadOpen: vi.fn(),
    onKeyDown: vi.fn(),
    onNavigationItemsChange: vi.fn(),
    onQueryChange: vi.fn(),
    onSelectItem: vi.fn(),
    query: "",
  }),
}));

vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitDrag: () => ({}),
}));

vi.mock("./ProjectList", () => ({
  ProjectList: () => null,
  ProjectListActionButtons: () => null,
}));

vi.mock("./crew/CrewSidebarSection", () => ({
  CrewEditProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  CrewSidebarSection: () => null,
  ChatsSidebarSection: () => null,
}));

vi.mock("./crew/PlatformSection", () => ({
  PlatformSection: () => null,
}));

vi.mock("./PluginThreadList", () => ({
  PluginThreadList: () => null,
}));

vi.mock("@/components/plugin/PluginFrontendFailureNotice", () => ({
  PluginFrontendFailureNotice: () => null,
}));

vi.mock("@/components/plugin/PluginSidebarFooterActions", () => ({
  PluginSidebarFooterActions: () => null,
}));

vi.mock("./SidebarUpdatesBadge", () => ({
  SidebarUpdatesBadge: () => null,
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  Sidebar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuButton: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  useCloseMobileSidebar: () => vi.fn(),
  useSidebar: () => ({
    isCompactViewport: false,
    setOpen: vi.fn(),
    setOpenMobile: vi.fn(),
  }),
}));

function renderSidebar(quickCreateProject: QuickCreateProjectController) {
  return render(
    <MemoryRouter>
      <AppSidebar
        quickCreateProject={quickCreateProject}
        onResizeMouseDown={vi.fn()}
        isResizing={false}
        showTopReserve={false}
        settingsRoutePath="/settings"
      />
    </MemoryRouter>,
  );
}

describe("AppSidebar new-project affordance", () => {
  afterEach(cleanup);

  it("offers exactly one New project action", () => {
    // The Projects header used to carry an icon-only copy of the button
    // already sitting above it: same dialog, two places to find it, two names
    // read out by a screen reader.
    renderSidebar(makeController());
    expect(
      screen.getAllByRole("button", { name: "New project from a folder" }),
    ).toHaveLength(1);
  });

  it("shows New project only when quick create is available", () => {
    renderSidebar(makeController({ isAvailable: false }));
    expect(screen.queryByTestId("new-project-button")).toBeNull();
  });

  it("opens the project path dialog when New project is pressed", () => {
    const quickCreateProject = makeController();
    renderSidebar(quickCreateProject);
    fireEvent.click(screen.getByTestId("new-project-button"));
    expect(quickCreateProject.openCreateDialog).toHaveBeenCalledTimes(1);
  });
});
