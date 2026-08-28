import { useCallback, useState } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { ThreadStorageBrowser } from "@/components/secondary-panel/ThreadStorageBrowser";
import { useThreadStorageBrowser } from "@/components/secondary-panel/useThreadStorageBrowser";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { SecondaryPanelFilePreview } from "@/components/secondary-panel/ThreadStorageFilePreview";
import { useEnvironmentFilePreview } from "@/hooks/queries/environment-queries";
import { Button } from "@bb/shared-ui/button";
import { useAddPathToChat } from "./worktree-file-actions";
import { useWorktreeFileEditor } from "./useWorktreeFileEditor";
import { useWorktreeFiles } from "./useWorktreeFiles";

/**
 * The agent's own worktree, in the same file browser the thread-storage panel
 * uses — same tree, same theming, same coarse-pointer sizing, pointed at the
 * checkout instead of the thread's storage dir.
 *
 * Files are editable. The write surface is the agent's OWN worktree — an
 * isolated checkout, which is exactly where a change is allowed to land — and
 * every save carries the hash the file had when it was opened, so a write that
 * would land on top of the agent's own is refused rather than silently winning.
 */
export function FilesTab({ agentId }: { agentId: string }) {
  const {
    environmentId,
    files,
    truncated,
    rootPath,
    hostId,
    isLoading,
    error,
  } = useWorktreeFiles(agentId);
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

  const editor = useWorktreeFileEditor({
    hostId,
    rootPath,
    // The preview reads through its own cache, so a saved file would otherwise
    // render as the version that was just replaced. Refetching THAT query is
    // the whole need — dropping every cache in the app to refresh one file
    // would evict work the rest of the screen is still using.
    onSaved: () => void preview.refetch(),
  });

  const controller = useThreadStorageBrowser({
    // Rows become draggable so a path can be dragged into the chat. Nothing may
    // be dropped INTO the tree: a file view that could MOVE files by dropping
    // them on each other is a file manager nobody asked for — editing a file's
    // contents is a different thing from rearranging a worktree.
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
      <div className="flex min-h-0 flex-1">
        <div
          className="flex min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-tower-border"
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
          {/* The filter belongs to the tree, so it lives in the tree's own rail
              rather than as a full-width bar over a panel it does not filter. */}
          <div className="shrink-0 border-b border-tower-border px-2 py-1.5">
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
                onChange={(event) =>
                  controller.setSearchQuery(event.target.value)
                }
              />
            </div>
          </div>
          {/* The tree is virtualised and its own root is h-full, so it needs a
              growing box with a floor — without one it renders zero rows. */}
          <div className="min-h-0 flex-1">
            <ThreadStorageBrowser
              controller={controller}
              // The path, not just the emptiness. An empty worktree and a panel
              // pointed at the wrong place look identical otherwise, and this
              // exact ambiguity sent me hunting a bug that was not there.
              emptyMessage={
                rootPath === null ? undefined : `${rootPath} is empty`
              }
              filesError={error}
              isFilesLoading={isLoading}
            />
          </div>
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
                {editor.editing === null ? (
                  <>
                    {addPathToChat === null ? null : (
                      <button
                        type="button"
                        onClick={() => addPathToChat(selectedPath)}
                        className="shrink-0 rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-tower-accent hover:text-foreground"
                      >
                        Add to chat
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => editor.open(selectedPath)}
                      disabled={editor.status.kind === "opening"}
                      className="shrink-0 rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-tower-accent hover:text-foreground disabled:opacity-50"
                    >
                      {editor.status.kind === "opening" ? "Opening…" : "Edit"}
                    </button>
                  </>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={editor.cancel}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={editor.save}
                      disabled={editor.status.kind === "saving"}
                    >
                      {editor.status.kind === "saving" ? "Saving…" : "Save"}
                    </Button>
                  </div>
                )}
              </div>
              {editor.status.kind === "conflict" ? (
                // The file changed underneath the edit. Offering "save anyway"
                // here would be offering to destroy an agent's work with one
                // click, so the only ways out are keeping the text or dropping
                // it — both of which the operator has to choose.
                <p
                  role="alert"
                  className="shrink-0 border-b border-tower-border px-3 py-2 text-xs text-destructive-text"
                >
                  This file changed on disk since you opened it — most likely
                  the agent working in it. Nothing was overwritten. Copy
                  anything you want to keep, then cancel and reopen it.
                </p>
              ) : editor.status.kind === "error" ? (
                <p
                  role="alert"
                  className="shrink-0 border-b border-tower-border px-3 py-2 text-xs text-destructive-text"
                >
                  {editor.status.message}
                </p>
              ) : null}
              {editor.editing !== null ? (
                <textarea
                  aria-label={`Edit ${editor.editing.path}`}
                  className="min-h-0 flex-1 resize-none bg-background px-4 py-3 font-mono text-xs leading-5 text-foreground outline-none"
                  spellCheck={false}
                  value={editor.editing.text}
                  onChange={(event) => editor.setText(event.target.value)}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <SecondaryPanelFilePreview
                    activePath={selectedPath}
                    copyPath={selectedPath}
                    error={(preview.error as Error | null) ?? null}
                    filePreview={preview.data}
                    isLoading={preview.isLoading}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {truncated ? (
        // Only a worktree past the host's own ceiling reaches this now. Saying
        // so is still the whole point: a tree that quietly ends looks like a
        // small worktree, and the count is what makes it believable.
        <p className="shrink-0 px-3 py-2 text-xs text-muted-foreground">
          {`This worktree has more files than the host will list at once. Showing the first ${(files?.length ?? 0).toLocaleString()}.`}
        </p>
      ) : null}
    </div>
  );
}
