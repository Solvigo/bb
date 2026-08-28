import { useCallback, useState } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { ThreadStorageBrowser } from "@/components/secondary-panel/ThreadStorageBrowser";
import { useThreadStorageBrowser } from "@/components/secondary-panel/useThreadStorageBrowser";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { useWorktreeFiles } from "./useWorktreeFiles";
import { useWorktreeFileOpener } from "./worktree-file-open";

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
  const openFile = useWorktreeFileOpener();
  const onSelectPath = useCallback(
    (path: string) => {
      setSelectedPath(path);
      // The panel already owns file tabs — chrome, previews, close buttons —
      // so picking a file hands it the path rather than growing a second
      // viewer in here. Without an opener the tree is still a tree: it
      // selects, and nothing pretends a click did more than it did.
      openFile?.(path);
    },
    [openFile],
  );

  const controller = useThreadStorageBrowser({
    files,
    onSelectPath,
    selectedPath,
  });

  if (!isLoading && rootPath === null) {
    return (
      <EmptyStatePanel
        role="status"
        className="py-8"
        data-testid="files-tab-worktree"
      >
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
    <div
      // h-full and a growing child are not decoration: the browser's own root
      // is h-full, and the tree inside it is virtualised, so a parent with no
      // height renders ZERO rows while anything with intrinsic height — the
      // truncation note below — still shows. That combination reads exactly
      // like a broken tree over working data.
      className="flex h-full min-h-0 flex-col"
      data-testid="files-tab-worktree"
      // What this panel believes about itself, so a failure can be read from
      // the outside instead of inferred from an empty list. It earned its keep
      // immediately: an empty tree here looked like a broken tab until these
      // said ready/0, which matched what the host reported for that path.
      data-files-state={isLoading ? "loading" : error ? "error" : "ready"}
      data-files-count={files?.length ?? -1}
    >
      <div className="shrink-0 px-1 pb-1">
        <div className="relative">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter files"
            className="h-7 pl-7 pr-2 text-xs focus-visible:ring-0"
            placeholder="Filter files…"
            value={controller.searchQuery}
            onChange={(event) => controller.setSearchQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ThreadStorageBrowser
          controller={controller}
          filesError={error}
          isFilesLoading={isLoading}
        />
      </div>
      {truncated ? (
        // The host stopped listing before the end. Saying so is the whole
        // point: a tree that quietly ends looks like a small worktree.
        <p className="shrink-0 px-3 py-2 text-xs text-muted-foreground">
          Showing the first files in this worktree — the list was truncated.
        </p>
      ) : null}
    </div>
  );
}
