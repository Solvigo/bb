import { useCallback, useState } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { ThreadStorageBrowser } from "@/components/secondary-panel/ThreadStorageBrowser";
import { useThreadStorageBrowser } from "@/components/secondary-panel/useThreadStorageBrowser";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { SecondaryPanelFilePreview } from "@/components/secondary-panel/ThreadStorageFilePreview";
import { useEnvironmentFilePreview } from "@/hooks/queries/environment-queries";
import { useAddPathToChat } from "./worktree-file-actions";
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
  const { environmentId, files, truncated, rootPath, isLoading, error } =
    useWorktreeFiles(agentId);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const addPathToChat = useAddPathToChat();
  const onSelectPath = useCallback((path: string) => setSelectedPath(path), []);

  // The file opens BESIDE the tree, not as a tab in the strip above: this is a
  // file view, and leaving the tree on screen is the whole point of one.
  const preview = useEnvironmentFilePreview(
    environmentId,
    selectedPath ?? "",
    { kind: "working-tree" },
    { enabled: Boolean(environmentId && selectedPath) },
  );

  const controller = useThreadStorageBrowser({
    // Rows become draggable so a path can be dragged into the chat. Nothing may
    // be dropped INTO the tree: this view is read-only, and a file view that
    // could move files would be a file manager nobody asked for.
    dragAndDrop: { canDrop: () => false },
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
      <div className="flex min-h-0 flex-1">
        <div
          className="min-h-0 w-64 shrink-0 overflow-hidden border-r border-tower-border"
          // Drag events are composed, so a dragstart inside the tree's shadow
          // root reaches this listener with the row in its composed path. The
          // payload is the path as PLAIN TEXT and nothing more: a composer is a
          // textarea, and a textarea already knows how to accept dropped text.
          onDragStart={(event) => {
            const row = event.nativeEvent
              .composedPath()
              .find(
                (node): node is HTMLElement =>
                  node instanceof HTMLElement &&
                  node.dataset.itemPath !== undefined,
              );
            const path = row?.dataset.itemPath;
            if (path === undefined || row?.dataset.itemType !== "file") return;
            event.dataTransfer.setData("text/plain", path);
            event.dataTransfer.effectAllowed = "copy";
          }}
        >
          <ThreadStorageBrowser
            controller={controller}
            filesError={error}
            isFilesLoading={isLoading}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {selectedPath === null ? (
            <div className="flex h-full items-center justify-center px-4">
              <p className="text-xs text-muted-foreground">
                Pick a file to read it here.
              </p>
            </div>
          ) : (
            <>
              {/* The path, as a trail rather than one long string — the tree
                  beside it already shows where you are, so this is orientation
                  for the pane, not navigation. */}
              <div className="flex shrink-0 items-center gap-1 px-3 py-2 text-xs text-muted-foreground">
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                  {selectedPath.split("/").map((segment, index, segments) => (
                    <span
                      key={`${segment}-${index}`}
                      className="whitespace-nowrap"
                    >
                      {index > 0 ? (
                        <span className="px-1 opacity-60">/</span>
                      ) : null}
                      <span
                        className={
                          index === segments.length - 1 ? "text-foreground" : ""
                        }
                      >
                        {segment}
                      </span>
                    </span>
                  ))}
                </div>
                {/* The same reference the drag makes, for anyone who would
                    rather press a button than drag one — and for a pointer
                    that cannot drag at all. */}
                {addPathToChat === null ? null : (
                  <button
                    type="button"
                    onClick={() => addPathToChat(selectedPath)}
                    className="shrink-0 rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-tower-accent hover:text-foreground"
                  >
                    Add to chat
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <SecondaryPanelFilePreview
                  activePath={selectedPath}
                  copyPath={selectedPath}
                  error={(preview.error as Error | null) ?? null}
                  filePreview={preview.data}
                  isLoading={preview.isLoading}
                />
              </div>
            </>
          )}
        </div>
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
