import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { THREAD_JUMP_APP_COMMAND_IDS } from "@bb/domain";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useCloseMobileSidebar,
  useSidebar,
} from "@/components/ui/sidebar.js";
import { ProjectList, ProjectListActionButtons } from "./ProjectList";
import {
  ChatsSidebarSection,
  CrewSidebarSection,
  NewCrewButton,
} from "./crew/CrewSidebarSection";
import { AirwaysMark } from "./crew/BrandLockup";
import { PlatformSection } from "./crew/PlatformSection";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListProvider } from "./threadListProvider";
import { PluginFrontendFailureNotice } from "@/components/plugin/PluginFrontendFailureNotice";
import { PluginSidebarFooterActions } from "@/components/plugin/PluginSidebarFooterActions";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import type { QuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import type { SidebarThreadSearchNavigationItem } from "./sidebarThreadSearch";
import { useSidebarThreadSearch } from "./useSidebarThreadSearch";
import {
  EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS,
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  SidebarThreadShortcutKeysContext,
  type SidebarThreadShortcutPresentation,
  type SidebarThreadShortcutTarget,
} from "./sidebarThreadShortcuts";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
  useAppCommandShortcuts,
  useIsAppCommandModifierHeld,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useRouteState } from "@/hooks/useRouteState";
import { PRODUCT_NAME } from "@/lib/product";

const NEW_THREAD_PANE_CONTENT = { kind: "new-thread" } as const;

const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/get-bb/bb/issues/new";
const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

interface AppSidebarProps {
  /**
   * The create-project controller from the layout that RENDERS its dialog.
   * The sidebar must not call the hook itself: its dialog state would be a
   * second, separate copy, and opening it would set state on a dialog nothing
   * renders — a button that looks alive and does nothing.
   */
  quickCreateProject: QuickCreateProjectController;
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
  settingsRoutePath: string;
  toolsRoutePath?: string;
}

const SIDEBAR_ACCOUNT_LABEL = PRODUCT_NAME.split(" ")[0] ?? PRODUCT_NAME;

export function AppSidebar({
  quickCreateProject,
  onResizeMouseDown,
  isResizing,
  showTopReserve,
  settingsRoutePath,
  toolsRoutePath,
}: AppSidebarProps) {
  // A plugin may replace the sidebar's scrolling thread list. It never
  // replaces the chrome around it: the New-thread button, the search field,
  // the plugin nav rows, and the footer stay host-rendered in every sidebar.
  const threadListProvider = useThreadListProvider();
  const { threadId: activeThreadId } = useRouteState();
  const navigate = useNavigate();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const newThreadSplit = usePaneContentSplitDrag({
    content: NEW_THREAD_PANE_CONTENT,
    enabled: threadSplitsEnabled,
    label: "New thread",
  });
  const closeOnMobile = useCloseMobileSidebar();
  const { isCompactViewport, setOpen, setOpenMobile } = useSidebar();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const [threadShortcutKeysById, setThreadShortcutKeysById] = useState<
    ReadonlyMap<string, SidebarThreadShortcutPresentation>
  >(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const threadShortcutTargetsRef = useRef<
    readonly SidebarThreadShortcutTarget[]
  >([]);
  const isPointerCoarse = usePointerCoarse();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const threadJumpShortcuts = useAppCommandShortcuts(
    THREAD_JUMP_APP_COMMAND_IDS,
  );
  const isAppCommandModifierHeld = useIsAppCommandModifierHeld();
  const settingsShortcut = useAppCommandShortcut("settings.open");

  const openSidebarForThreadSearch = useCallback(() => {
    if (isCompactViewport) {
      setOpenMobile(true);
    } else {
      setOpen(true);
    }
  }, [isCompactViewport, setOpen, setOpenMobile]);

  const openSearchedThread = useCallback(
    (item: SidebarThreadSearchNavigationItem) => {
      void navigate(
        getThreadRoutePath({
          projectId: item.projectId,
          threadId: item.threadId,
        }),
        // Hand the matched message's event sequence to the timeline so it can
        // scroll to and briefly highlight that message. Omitted for title-only
        // matches, which just open the thread normally.
        item.messageSeq !== null
          ? {
              state: {
                searchMessageSeq: item.messageSeq,
                searchThreadId: item.threadId,
              },
            }
          : undefined,
      );
    },
    [navigate],
  );

  const threadSearch = useSidebarThreadSearch({
    isPointerCoarse,
    onOpenSidebar: openSidebarForThreadSearch,
    onOpenThread: openSearchedThread,
    onThreadOpened: closeOnMobile,
  });

  const handleNewChat = useCallback(() => {
    closeOnMobile();
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate]);

  const showThreadShortcuts = useCallback(() => {
    const targets = getSidebarThreadShortcutTargets(sidebarRef.current);
    threadShortcutTargetsRef.current = targets;
    setThreadShortcutKeysById(
      new Map(
        targets.flatMap((target, index) => {
          const command = THREAD_JUMP_APP_COMMAND_IDS[index];
          const shortcut = command
            ? threadJumpShortcuts.get(command)
            : undefined;
          return shortcut ? [[target.threadId, shortcut] as const] : [];
        }),
      ),
    );
  }, [threadJumpShortcuts]);

  const hideThreadShortcuts = useCallback(() => {
    threadShortcutTargetsRef.current = [];
    setThreadShortcutKeysById(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  }, []);

  const activateThreadShortcut = useCallback((index: number): boolean => {
    const targets = threadShortcutTargetsRef.current;
    const target =
      targets[index] ??
      getSidebarThreadShortcutTargets(sidebarRef.current)[index];
    if (!target) return false;
    target.element.click();
    return true;
  }, []);

  const activateAdjacentThread = useCallback(
    (offset: -1 | 1): boolean => {
      const targets = getSidebarThreadNavigationTargets(sidebarRef.current);
      if (targets.length === 0) return false;
      const activeIndex = targets.findIndex(
        (target) => target.threadId === activeThreadId,
      );
      const nextIndex =
        activeIndex === -1
          ? offset === 1
            ? 0
            : targets.length - 1
          : (activeIndex + offset + targets.length) % targets.length;
      targets[nextIndex]?.element.click();
      return true;
    },
    [activeThreadId],
  );

  useAppCommandHandler("thread.search", () => {
    threadSearch.onActivate();
    return true;
  });
  useIndexedAppCommandHandlers(
    THREAD_JUMP_APP_COMMAND_IDS,
    activateThreadShortcut,
  );
  useAppCommandHandler("thread.previous", () => activateAdjacentThread(-1));
  useAppCommandHandler("thread.next", () => activateAdjacentThread(1));

  useEffect(() => {
    if (isAppCommandModifierHeld) {
      showThreadShortcuts();
      return;
    }
    hideThreadShortcuts();
  }, [hideThreadShortcuts, isAppCommandModifierHeld, showThreadShortcuts]);

  const builtInThreadList = (
    <ProjectList
      onNewProject={
        quickCreateProject.isAvailable
          ? quickCreateProject.openCreateDialog
          : undefined
      }
      onProjectSelect={closeOnMobile}
      isCreatingProject={quickCreateProject.isCreating}
      threadSearch={{
        activeIndex: threadSearch.activeIndex,
        isActive: threadSearch.isActive,
        onActiveIndexChange: threadSearch.onActiveIndexChange,
        onNavigationItemsChange: threadSearch.onNavigationItemsChange,
        onSelectItem: threadSearch.onSelectItem,
        query: threadSearch.query,
      }}
    />
  );
  const sidebarSearchControl = (
    <ProjectListActionButtons
      showNewThread={false}
      splitEnabled={threadSplitsEnabled}
      newThreadSplit={newThreadSplit}
      onNewChat={handleNewChat}
      threadSearch={{
        activeDescendantId: threadSearch.activeDescendantId,
        inputRef: threadSearch.inputRef,
        isActive: threadSearch.isActive,
        onActivate: threadSearch.onActivate,
        onClose: threadSearch.onClose,
        onQueryChange: threadSearch.onQueryChange,
        query: threadSearch.query,
      }}
    />
  );
  const sidebarIdentityControls = threadSearch.isActive ? (
    <div
      className={cn(
        "min-w-0 flex-1",
        usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
      )}
    >
      {sidebarSearchControl}
    </div>
  ) : (
    <>
      <div className="flex min-w-0 flex-1 items-center">
        <AirwaysMark size={22} />
      </div>
      <div className={cn(usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS)}>
        {sidebarSearchControl}
      </div>
    </>
  );

  return (
    <SidebarThreadShortcutKeysContext.Provider value={threadShortcutKeysById}>
      <Sidebar ref={sidebarRef} onKeyDown={threadSearch.onKeyDown}>
        {showTopReserve ? (
          /* The identity and search controls share the title-bar reserve rather
             than sitting below an empty chrome row. This keeps the rail compact
             while the row still supplies the desktop window-drag strip. */
          <div
            data-testid="app-sidebar-top-reserve-row"
            className={cn(
              CHROME_ROW_CLASS,
              "shrink-0 gap-2 px-3 group-data-[collapsible=icon]:hidden",
              usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
            )}
          >
            {sidebarIdentityControls}
          </div>
        ) : (
          <div className="flex min-h-11 shrink-0 items-center gap-2 px-3 pb-1 pt-2 group-data-[collapsible=icon]:hidden">
            {sidebarIdentityControls}
          </div>
        )}
        <div className="shrink-0 px-2 pb-2 group-data-[collapsible=icon]:hidden">
          <NewCrewButton />
        </div>
        <PlatformSection onNavigate={closeOnMobile} />
        {/* Two bands, and every thread is in one of them: PROJECTS carries the
            agent trees, CHATS carries the threads nobody has crewed. The old
            "All threads" drawer was the escape hatch for whatever the crew view
            did not surface — with both bands present there is nothing left
            unsurfaced, and a second list over the same threads is the
            duplication this layout exists to end. */}
        <SidebarContent>
          {threadSearch.isActive ? (
            // Searching replaces the bands rather than adding a third list:
            // the thread list owns result rendering and arrow-key navigation,
            // and it is the only thing here that reaches every thread at once.
            threadListProvider ? (
              <PluginThreadList
                slot={threadListProvider}
                builtInFallback={builtInThreadList}
                searchQuery={threadSearch.query}
                onNavigate={threadSearch.onExternalThreadOpen}
              />
            ) : (
              builtInThreadList
            )
          ) : (
            <>
              <CrewSidebarSection
                onNavigate={closeOnMobile}
                headerTrailing={
                  quickCreateProject.isAvailable ? (
                    <button
                      type="button"
                      aria-label="New project from a folder"
                      onClick={quickCreateProject.openCreateDialog}
                      disabled={quickCreateProject.isCreating}
                      className="grid size-5 shrink-0 place-items-center rounded text-subtle-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-50"
                    >
                      <Icon
                        name="FolderPlus"
                        className="size-3.5"
                        aria-hidden
                      />
                    </button>
                  ) : null
                }
              />
              <ChatsSidebarSection
                onNavigate={closeOnMobile}
                onNewChat={handleNewChat}
              />
            </>
          )}
        </SidebarContent>
        <SidebarFooter className="relative px-3 py-2 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-tower-border">
          {/* A plugin with no interface says so here. It cannot say it anywhere
              else: a registration that throws leaves no slot to put a chip in,
              so the notice has to live somewhere that is always on screen. */}
          <PluginFrontendFailureNotice />
          <OverflowFade placement="above" tone="sidebar" size="sm" />
          {/* Codex-style account/action strip: identity anchors the left edge,
           * plugin actions sit beside it, and help/updates finish the row. */}
          <SidebarMenu className="flex-row items-center gap-1">
            <SidebarMenuItem className="min-w-0 flex-1">
              <SidebarMenuButton
                asChild
                aria-label={
                  settingsShortcut
                    ? `Settings (${settingsShortcut.label})`
                    : "Settings"
                }
                aria-keyshortcuts={settingsShortcut?.ariaKeyshortcuts}
                tooltip={{
                  children: settingsShortcut
                    ? `Settings (${settingsShortcut.label})`
                    : "Settings",
                  hidden: false,
                  side: "top",
                }}
                className={cn(
                  SIDEBAR_FOOTER_ACTION_CLASS,
                  "h-8 w-full justify-start gap-2 px-1.5",
                )}
              >
                <Link to={settingsRoutePath} onClick={closeOnMobile}>
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-foreground">
                    {SIDEBAR_ACCOUNT_LABEL.charAt(0)}
                  </span>
                  <span className="min-w-0 truncate text-xs">
                    {SIDEBAR_ACCOUNT_LABEL}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <PluginSidebarFooterActions onNavigate={closeOnMobile} />
            <SidebarMenuItem className="min-w-0">
              <SidebarMenuButton
                className={SIDEBAR_FOOTER_ACTION_CLASS}
                tooltip={{
                  children: "Report a bug",
                  hidden: false,
                  side: "top",
                }}
                aria-label="Report a bug"
                onClick={() => {
                  closeOnMobile();
                  openUrlInExternalBrowser(BUG_REPORT_NEW_ISSUE_URL);
                }}
              >
                <Icon name="CircleQuestion" />
                <span className="sr-only">Report a bug</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarUpdatesBadge onNavigate={closeOnMobile} />
          </SidebarMenu>
        </SidebarFooter>
        <div
          data-testid="app-sidebar-resize-handle"
          className={cn(
            "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
            "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
            "group-data-[collapsible=icon]:hidden",
            isResizing && "before:bg-sidebar-border",
          )}
          onMouseDown={onResizeMouseDown}
        />
      </Sidebar>
    </SidebarThreadShortcutKeysContext.Provider>
  );
}
