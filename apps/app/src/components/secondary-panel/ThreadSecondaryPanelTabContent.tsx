import { useCallback, useEffect, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { SecondaryPanelEmptyState } from "./SecondaryPanelEmptyState";
import {
  useEnvironmentDiffFiles,
  useEnvironmentFilePreview,
} from "@/hooks/queries/environment-queries";
import { useProjectFilePreview } from "@/hooks/queries/project-queries";
import {
  useThreadHostFilePreview,
  useThreadStorageFilePreview,
} from "@/hooks/queries/thread-queries";
import {
  buildRawFilesystemHtmlContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import type {
  EnvironmentFilePreviewSource,
  FilePreviewLineRange,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import { DiffFilesPanel } from "./git-diff/DiffFilesPanel";
import { clearDiffFileCardStates } from "./git-diff/diffFilesStore";
import { buildGitDiffIdentity } from "./git-diff/gitDiffPanelHelpers";
import { useDiffFileContentsRequester } from "./git-diff/useDiffFileContentsRequester";
import { pendingGitDiffScrollPathAtom } from "./threadSecondaryPanelAtoms";
import {
  SecondaryPanelFilePreview,
  ThreadStorageFilePreview,
} from "./ThreadStorageFilePreview";

export interface GitDiffTabContentProps {
  environmentId?: string;
  target: WorkspaceDiffTarget | undefined;
  isDiffPanelActive: boolean;
  gitDiffViewOptions: Record<string, string | boolean | number>;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
  workspaceRootPath?: string | null;
}

export interface ThreadInfoTabContentProps {
  metadataContent: ReactNode;
}

export interface WorkspaceFilePreviewTabContentProps {
  activePath: string;
  copyPath?: string | null;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  source: EnvironmentFilePreviewSource | null;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  threadId?: string | null;
}

export interface ProjectFilePreviewTabContentProps {
  activePath: string;
  copyPath?: string | null;
  environmentId: string | null;
  hostId: string | null;
  lineRange: FilePreviewLineRange | null;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  projectId: string;
}

export interface HostFilePreviewTabContentProps {
  activePath: string;
  copyPath: string;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

export interface ThreadStorageFilePreviewTabContentProps {
  activePath: string;
  copyPath?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

/**
 * The diff tab body. Fetches the diff's table of contents
 * ({@link useEnvironmentDiffFiles}) and renders it through the virtualized
 * {@link DiffFilesPanel}, which fetches per-file patches on demand as rows
 * scroll into view. Handles the TOC's loading / empty / `not_applicable`
 * (`too_many_files`) / `unavailable` states; per-file patch errors surface as
 * retryable card errors inside the panel.
 */
export function GitDiffTabContent({
  environmentId,
  target,
  isDiffPanelActive,
  gitDiffViewOptions,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  workspaceRootPath,
}: GitDiffTabContentProps) {
  const isQueryEnabled =
    isDiffPanelActive && Boolean(environmentId) && target !== undefined;
  const {
    data: diffFilesResponse,
    dataUpdatedAt: diffFilesUpdatedAt,
    isLoading: isDiffFilesLoading,
    isPlaceholderData: isDiffFilesPlaceholder,
    error: diffFilesError,
  } = useEnvironmentDiffFiles(environmentId ?? "", {
    enabled: isQueryEnabled,
    target,
  });

  const mergeBaseRef =
    diffFilesResponse?.outcome === "available"
      ? diffFilesResponse.mergeBaseRef
      : null;
  const diffIdentity = buildGitDiffIdentity({
    environmentId,
    mergeBaseRef,
    target,
  });
  const onRequestFileContents = useDiffFileContentsRequester({
    environmentId,
    target,
    mergeBaseRef,
  });

  // A file opened from the info tab / prompt banner sets this path;
  // useGitDiffPanelState resets the diff to all-changes so the file is in the
  // slice, and the panel scrolls it into view, then clears the request here.
  const pendingGitDiffScrollPath = useAtomValue(pendingGitDiffScrollPathAtom);
  const setPendingGitDiffScrollPath = useSetAtom(pendingGitDiffScrollPathAtom);
  const clearPendingGitDiffScrollPath = useCallback(
    () => setPendingGitDiffScrollPath(null),
    [setPendingGitDiffScrollPath],
  );

  // Drop per-card UI state belonging to any other diff slice once a new target
  // / environment resolves, so collapse defaults are re-derived fresh rather
  // than inheriting a previous diff's choices at a shared path.
  useEffect(() => {
    clearDiffFileCardStates(diffIdentity);
  }, [diffIdentity]);

  const isPreparing =
    isQueryEnabled &&
    (target === undefined ||
      isDiffFilesLoading ||
      (diffFilesResponse === undefined && diffFilesError === null));

  if (isPreparing) {
    return (
      <SecondaryPanelEmptyState
        icon="Spinner"
        iconClassName="animate-spin"
        title="Loading diff"
        description="Checking this workspace for changes…"
        aria-busy="true"
      />
    );
  }

  if (diffFilesError) {
    return (
      <SecondaryPanelEmptyState
        icon="AlertTriangle"
        title="Couldn't load the diff"
        description={
          diffFilesError instanceof Error
            ? diffFilesError.message
            : "The workspace diff could not be loaded."
        }
        role="alert"
      />
    );
  }

  if (diffFilesResponse === undefined) {
    return (
      <SecondaryPanelEmptyState
        icon="FileDiff"
        title="No diff to display"
        description="Changes will appear here when this workspace has a diff."
      />
    );
  }

  if (diffFilesResponse.outcome === "unavailable") {
    return (
      <SecondaryPanelEmptyState
        icon="AlertTriangle"
        title="Workspace unavailable"
        description={diffFilesResponse.failure.message}
        role="alert"
      />
    );
  }

  if (diffFilesResponse.outcome === "not_applicable") {
    return (
      <SecondaryPanelEmptyState
        icon="FileDiff"
        title="No diff to display"
        description={diffFilesResponse.message}
      />
    );
  }

  if (diffFilesResponse.files.length === 0) {
    return (
      <SecondaryPanelEmptyState
        icon="FileDiff"
        title="No diff to display"
        description="Changes will appear here when this workspace has a diff."
      />
    );
  }

  // The panel needs a concrete target to drive its patch fetches; `isQueryEnabled`
  // above already guarantees both once an `available` outcome resolved.
  if (!environmentId || target === undefined) {
    return (
      <SecondaryPanelEmptyState
        icon="FileDiff"
        title="No diff to display"
        description="Changes will appear here when this workspace has a diff."
      />
    );
  }

  return (
    <DiffFilesPanel
      environmentId={environmentId}
      target={target}
      diffIdentity={diffIdentity}
      files={diffFilesResponse.files}
      initialPatches={diffFilesResponse.initialPatches}
      filesUpdatedAt={diffFilesUpdatedAt}
      diffViewOptions={gitDiffViewOptions}
      filePathRoot={workspaceRootPath}
      isPlaceholderData={isDiffFilesPlaceholder}
      scrollToPath={pendingGitDiffScrollPath}
      onScrolledToPath={clearPendingGitDiffScrollPath}
      onOpenFileInEditor={onOpenFileInEditor}
      onOpenFilePreview={onOpenFilePreview}
      onRequestFileContents={onRequestFileContents}
      onSelectionAddToChat={onSelectionAddToChat}
    />
  );
}

export function ThreadInfoTabContent({
  metadataContent,
}: ThreadInfoTabContentProps) {
  return <div className="flex min-h-0 flex-1 flex-col">{metadataContent}</div>;
}

export function WorkspaceFilePreviewTabContent({
  activePath,
  copyPath = null,
  environmentId,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  source,
  statusLabel,
  threadId,
}: WorkspaceFilePreviewTabContentProps) {
  const {
    data: workspaceFilePreview,
    error: workspaceFilePreviewError,
    isFetching: isWorkspaceFilePreviewFetching,
    isLoading: isWorkspaceFilePreviewLoading,
    refetch: refetchWorkspaceFilePreview,
  } = useEnvironmentFilePreview(environmentId, activePath, source);

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={workspaceFilePreviewError}
      filePreview={workspaceFilePreview}
      htmlPreviewUrl={
        threadId && source?.kind === "working-tree"
          ? buildThreadWorktreeRawContentUrl(threadId, activePath)
          : null
      }
      isLoading={isWorkspaceFilePreviewLoading}
      isRefreshing={isWorkspaceFilePreviewFetching}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetchWorkspaceFilePreview()}
      statusLabel={statusLabel}
    />
  );
}

export function ProjectFilePreviewTabContent({
  activePath,
  copyPath = null,
  environmentId,
  hostId,
  lineRange,
  onSelectionAddToChat,
  onOpenInEditor,
  projectId,
}: ProjectFilePreviewTabContentProps) {
  const {
    data: projectFilePreview,
    error: projectFilePreviewError,
    isFetching: isProjectFilePreviewFetching,
    isLoading: isProjectFilePreviewLoading,
    refetch: refetchProjectFilePreview,
  } = useProjectFilePreview(projectId, activePath, { environmentId, hostId });

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={projectFilePreviewError}
      filePreview={projectFilePreview}
      isLoading={isProjectFilePreviewLoading}
      isRefreshing={isProjectFilePreviewFetching}
      lineRange={lineRange}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetchProjectFilePreview()}
      statusLabel={null}
    />
  );
}

export function HostFilePreviewTabContent({
  activePath,
  copyPath,
  environmentId,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  threadId,
}: HostFilePreviewTabContentProps) {
  const {
    data: hostFilePreview,
    error: hostFilePreviewError,
    isFetching: isHostFilePreviewFetching,
    isLoading: isHostFilePreviewLoading,
    refetch: refetchHostFilePreview,
  } = useThreadHostFilePreview(threadId, environmentId, activePath);

  return (
    <SecondaryPanelFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={hostFilePreviewError}
      filePreview={hostFilePreview}
      htmlPreviewUrl={buildRawFilesystemHtmlContentUrl(threadId, activePath)}
      isLoading={isHostFilePreviewLoading}
      isRefreshing={isHostFilePreviewFetching}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetchHostFilePreview()}
      statusLabel={null}
    />
  );
}

export function ThreadStorageFilePreviewTabContent({
  activePath,
  copyPath = null,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  threadId,
}: ThreadStorageFilePreviewTabContentProps) {
  const {
    data: threadStorageFilePreview,
    error: threadStorageFilePreviewError,
    isFetching: isThreadStorageFilePreviewFetching,
    isLoading: isThreadStorageFilePreviewLoading,
    refetch: refetchThreadStorageFilePreview,
  } = useThreadStorageFilePreview(threadId, activePath);

  return (
    <ThreadStorageFilePreview
      activePath={activePath}
      copyPath={copyPath}
      error={threadStorageFilePreviewError}
      filePreview={threadStorageFilePreview}
      isLoading={isThreadStorageFilePreviewLoading}
      isRefreshing={isThreadStorageFilePreviewFetching}
      lineRange={lineRange}
      markdownLinkRouting={markdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      onRefresh={() => void refetchThreadStorageFilePreview()}
      threadId={threadId}
    />
  );
}
