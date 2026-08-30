import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginPanelActionEntry } from "@/components/plugin/PluginPanelActions";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { SIDE_CHAT_PLUGIN_ID } from "@/lib/side-chat-plugin";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import {
  NewTabFileSearch,
  type NewTabFileSearchProps,
  type OpenBrowserHandler,
  type StartTerminalHandler,
} from "./NewTabFileSearch";

type NewTabPageFileSearchProps = Omit<NewTabFileSearchProps, "idleActions">;

/** An agent surface offered on this page, so opening one is a deliberate act. */
export interface NewTabSurfaceOption {
  id: string;
  label: string;
  icon: IconName;
}

export interface NewTabPageProps extends NewTabPageFileSearchProps {
  onOpenBrowser?: OpenBrowserHandler;
  onOpenReview?: () => void;
  onOpenSurface?: (tabId: string) => void;
  onStartTerminal?: StartTerminalHandler;
  pluginActions?: readonly PluginPanelActionEntry[];
  surfaces?: readonly NewTabSurfaceOption[];
}

interface LauncherActionProps {
  icon: IconName;
  label: string;
  onSelect?: () => void;
  shortcut?: AppShortcutPresentation | null;
}

function LauncherAction({
  icon,
  label,
  onSelect,
  shortcut,
}: LauncherActionProps) {
  return (
    <button
      type="button"
      disabled={onSelect === undefined}
      onClick={onSelect}
      aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
      className={cn(
        "group flex h-10 w-full items-center gap-2.5 rounded-md border border-tower-border bg-tower-panel px-3 text-left text-sm text-tower-fg-body outline-none transition-colors",
        "hover:bg-tower-bright hover:text-tower-fg focus-visible:ring-1 focus-visible:ring-tower-fg-dim",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      <Icon
        name={icon}
        className="size-4 shrink-0 text-tower-fg-dim transition-colors group-hover:text-tower-fg-body"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? (
        <AppCommandShortcutPill
          shortcut={shortcut}
          className="bg-tower-bright text-tower-fg-dim opacity-100"
        />
      ) : null}
    </button>
  );
}

function NewTabLauncher({
  canSearchFiles,
  onOpenBrowser,
  onOpenFiles,
  onOpenReview,
  onOpenSideChat,
  onOpenSurface,
  onStartTerminal,
  pluginActions = [],
  surfaces = [],
}: {
  canSearchFiles: boolean;
  onOpenBrowser?: OpenBrowserHandler;
  onOpenFiles: () => void;
  onOpenReview?: () => void;
  onOpenSideChat?: () => void;
  onOpenSurface?: (tabId: string) => void;
  onStartTerminal?: StartTerminalHandler;
  pluginActions?: readonly PluginPanelActionEntry[];
  surfaces?: readonly NewTabSurfaceOption[];
}) {
  const reviewShortcut = useAppCommandShortcut("diff.toggle");
  const terminalShortcut = useAppCommandShortcut("terminal.open");
  const filesShortcut = useAppCommandShortcut("file.quickOpen");

  return (
    <div className="grid min-h-full place-items-center bg-tower-surface px-8 py-12">
      <div className="flex w-full max-w-lg flex-col gap-1.5">
        <LauncherAction
          icon="FileDiff"
          label="Review"
          onSelect={onOpenReview}
          shortcut={reviewShortcut}
        />
        <LauncherAction
          icon="Terminal"
          label="Terminal"
          onSelect={onStartTerminal}
          shortcut={terminalShortcut}
        />
        <LauncherAction icon="Globe" label="Browser" onSelect={onOpenBrowser} />
        <LauncherAction
          icon="Folder"
          label="Files"
          onSelect={canSearchFiles ? onOpenFiles : undefined}
          shortcut={filesShortcut}
        />
        {/* The agent's own surfaces. They used to mount themselves on every
            thread; opening one is a choice now, and this is where it is made.
            Headed, because "Browser" and "Files" exist on both sides of this
            list and mean different things: above opens a tab, below opens the
            agent's own view of itself — same accessible name, different
            action, so the group carries the distinction programmatically
            (`aria-labelledby`) rather than only in the visible heading a
            screen reader user tabbing through buttons never lands on. The
            `contents` wrapper keeps these two elements as direct flex
            children of the launcher list, exactly as if the group boundary
            were not there, so it changes nothing about the layout. */}
        {surfaces.length > 0 ? (
          <div
            role="group"
            aria-labelledby="new-tab-agent-surfaces-heading"
            className="contents"
          >
            <p
              id="new-tab-agent-surfaces-heading"
              className="px-1 pb-1 pt-3 text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
            >
              This agent
            </p>
            {surfaces.map((surface) => (
              <LauncherAction
                key={surface.id}
                icon={surface.icon}
                label={surface.label}
                onSelect={
                  onOpenSurface ? () => onOpenSurface(surface.id) : undefined
                }
              />
            ))}
          </div>
        ) : null}
        <LauncherAction
          icon="SideChat"
          label="Side chat"
          onSelect={onOpenSideChat}
        />
        {/* Panels contributed by plugins. Side chat has its own row above, so
            it is not repeated here. Without this the only plugin panel the
            page could ever open was side chat — every other one was
            registered, listed by the host, and unreachable. */}
        {pluginActions
          .filter((action) => action.pluginId !== SIDE_CHAT_PLUGIN_ID)
          .map((action) => (
            <LauncherAction
              key={action.id}
              icon={pluginIconName(action.icon)}
              label={action.title}
              onSelect={action.onSelect}
            />
          ))}
      </div>
    </div>
  );
}

/** Codex-style landing page for the right panel, with file search one step in. */
export function NewTabPage({
  currentThreadId,
  environmentId,
  hostId,
  focusRequest,
  initialQuery,
  onOpenBrowser,
  onOpenReview,
  onOpenSurface,
  onSelect,
  onStartTerminal,
  pluginActions,
  projectId,
  recentItemsThreadId,
  showFileSearch = true,
  surfaces,
}: NewTabPageProps) {
  const [isSearchingFiles, setIsSearchingFiles] = useState(
    () => (initialQuery?.trim().length ?? 0) > 0,
  );
  const previousFocusRequestRef = useRef(focusRequest);
  const sideChatAction = useMemo(
    () =>
      pluginActions?.find((action) => action.pluginId === SIDE_CHAT_PLUGIN_ID),
    [pluginActions],
  );

  useEffect(() => {
    if (previousFocusRequestRef.current === focusRequest) return;
    previousFocusRequestRef.current = focusRequest;
    setIsSearchingFiles(false);
  }, [focusRequest]);

  if (!isSearchingFiles) {
    return (
      <NewTabLauncher
        canSearchFiles={showFileSearch}
        onOpenBrowser={onOpenBrowser}
        onOpenFiles={() => setIsSearchingFiles(true)}
        onOpenReview={onOpenReview}
        onOpenSideChat={sideChatAction?.onSelect}
        onOpenSurface={onOpenSurface}
        onStartTerminal={onStartTerminal}
        pluginActions={pluginActions}
        surfaces={surfaces}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-3 bg-tower-surface px-4 pb-3 pt-3">
      <button
        type="button"
        onClick={() => setIsSearchingFiles(false)}
        className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md px-2 text-xs text-tower-fg-dim transition-colors hover:bg-tower-panel hover:text-tower-fg-body"
      >
        <Icon name="ChevronLeft" className="size-3.5" aria-hidden />
        All tools
      </button>
      <NewTabFileSearch
        projectId={projectId}
        environmentId={environmentId}
        hostId={hostId}
        currentThreadId={currentThreadId}
        focusRequest={focusRequest}
        idleActions={null}
        initialQuery={initialQuery}
        onSelect={onSelect}
        recentItemsThreadId={recentItemsThreadId}
        showFileSearch
      />
    </div>
  );
}
