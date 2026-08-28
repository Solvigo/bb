import { useQuery } from "@tanstack/react-query";
import type { HostFileListResponse } from "@bb/server-contract";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { sdk } from "@/lib/sdk";

/** One page of the tree. The response says when it stopped, and we say so too. */
const WORKTREE_FILE_LIMIT = 500;

export interface WorktreeFiles {
  files: HostFileListResponse["files"] | undefined;
  /** The host stopped listing before the end — shown, never swallowed. */
  truncated: boolean;
  /** The agent's own checkout, for the empty and non-git cases. */
  rootPath: string | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * The files in an agent's own worktree.
 *
 * Two hops, because the thread only knows which environment it runs in: thread
 * → environment (which carries the checkout path and its host) → the host's
 * file list. Listing is path-scoped rather than lease-scoped, so this needs no
 * lease and no new endpoint — the leases in the files API belong to previews.
 */
export function useWorktreeFiles(threadId: string | null): WorktreeFiles {
  const threadQuery = useThread(threadId ?? "", { enabled: Boolean(threadId) });
  const environmentId = threadQuery.data?.environmentId ?? null;
  const environmentQuery = useEnvironment(environmentId);
  const environment = environmentQuery.data ?? null;
  const rootPath = environment?.path ?? null;
  const hostId = environment?.hostId ?? null;

  const filesQuery = useQuery<HostFileListResponse>({
    queryKey: ["worktree-files", hostId, rootPath],
    queryFn: ({ signal }) =>
      sdk.files.list({
        hostId: hostId ?? undefined,
        path: rootPath ?? "",
        limit: WORKTREE_FILE_LIMIT,
        signal,
      }),
    enabled: Boolean(rootPath),
  });

  return {
    files: filesQuery.data?.files,
    truncated: filesQuery.data?.truncated === true,
    rootPath,
    // The tree is unknown until BOTH hops land: a thread whose environment has
    // not arrived is still loading, not empty.
    isLoading:
      threadQuery.isLoading ||
      environmentQuery.isLoading ||
      (Boolean(rootPath) && filesQuery.isLoading),
    error:
      (filesQuery.error as Error | null) ??
      (environmentQuery.error as Error | null) ??
      null,
  };
}
