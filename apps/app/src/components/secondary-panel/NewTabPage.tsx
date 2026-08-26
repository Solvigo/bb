import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginPanelActionEntry } from "@/components/plugin/PluginPanelActions";
import {
  AppCommandShortcutPill,
} from "@/components/commands/AppCommandShortcutHint";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { SIDE_CHAT_PLUGIN_ID } from "@/lib/side-chat-plugin";
import {
  NewTabFileSearch,
  type NewTabFileSearchProps,
  type OpenBrowserHandler,
  type StartTerminalHandler,
} from "./NewTabFileSearch";

type NewTabPageFileSearchProps = Omit<NewTabFileSearchProps, "idleActions">;

export interface NewTabPageProps extends NewTabPageFileSearchProps {
  onOpenBrowser?: OpenBrowserHandler;
  onOpenReview?: () => void;
  onStartTerminal?: StartTerminalHandler;
  pluginActions?: readonly PluginPanelActionEntry[];
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
  onStartTerminal,
}: {
  canSearchFiles: boolean;
  onOpenBrowser?: OpenBrowserHandler;
  onOpenFiles: () => void;
  onOpenReview?: () => void;
  onOpenSideChat?: () => void;
  onStartTerminal?: StartTerminalHandler;
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
        <LauncherAction
          icon="Globe"
          label="Browser"
          onSelect={onOpenBrowser}
        />
        <LauncherAction
          icon="Folder"
          label="Files"
          onSelect={canSearchFiles ? onOpenFiles : undefined}
          shortcut={filesShortcut}
        />
        <LauncherAction
          icon="SideChat"
          label="Side chat"
          onSelect={onOpenSideChat}
        />
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
  onSelect,
  onStartTerminal,
  pluginActions,
  projectId,
  recentItemsThreadId,
  showFileSearch = true,
}: NewTabPageProps) {
  const [isSearchingFiles, setIsSearchingFiles] = useState(
    () => (initialQuery?.trim().length ?? 0) > 0,
  );
  const previousFocusRequestRef = useRef(focusRequest);
  const sideChatAction = useMemo(
    () =>
      pluginActions?.find(
        (action) => action.pluginId === SIDE_CHAT_PLUGIN_ID,
      ),
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
        onStartTerminal={onStartTerminal}
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
