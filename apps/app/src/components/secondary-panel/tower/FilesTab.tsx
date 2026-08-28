import { useCallback, useState } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { ThreadStorageBrowser } from "@/components/secondary-panel/ThreadStorageBrowser";
import { useThreadStorageBrowser } from "@/components/secondary-panel/useThreadStorageBrowser";
import { useWorktreeFiles } from "./useWorktreeFiles";

/**
 * The agent's own worktree, in the same file browser the thread-storage panel
 * uses — same tree, same theming, same coarse-pointer sizing, pointed at the
 * checkout instead of the thread's storage dir.
 *
 * Read-only, deliberately: this is the operator's window into what an agent is
 * working on, not a write path into a crew's isolated checkout.
 */
export function FilesTab({ agentId }: { agentId: string }) {
  const { files, truncated, rootPath, isLoading, error } =
    useWorktreeFiles(agentId);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const onSelectPath = useCallback((path: string) => setSelectedPath(path), []);

  const controller = useThreadStorageBrowser({
    files,
    onSelectPath,
    selectedPath,
  });

  if (!isLoading && rootPath === null) {
    return (
      <EmptyStatePanel role="status" className="py-8">
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm text-foreground">No worktree yet</p>
          <p className="text-xs text-muted-foreground">
            This agent has no checkout of its own — nothing to browse until it
            has one.
          </p>
        </div>
      </EmptyStatePanel>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <ThreadStorageBrowser
        controller={controller}
        filesError={error}
        isFilesLoading={isLoading}
      />
      {truncated ? (
        // The host stopped listing before the end. Saying so is the whole
        // point: a tree that quietly ends looks like a small worktree.
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Showing the first files in this worktree — the list was truncated.
        </p>
      ) : null}
    </div>
  );
}
