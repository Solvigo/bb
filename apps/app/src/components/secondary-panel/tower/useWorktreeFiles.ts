import { useQuery } from "@tanstack/react-query";
import { FILE_LIST_LIMIT_MAX } from "@bb/domain";
import type { HostFileListResponse } from "@bb/server-contract";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { sdk } from "@/lib/sdk";

/**
 * Ask for the whole worktree, not a page of it.
 *
 * "Why can't we show all the files?" was a fair question: the tree stopped at
 * 500 and said so, which reads as a limit of the product rather than a number
 * someone picked. The host's own ceiling is 10,000 and it does not charge much
 * for the difference — measured on this repo, the complete listing is 3,969
 * files in under half a second, against 500 in the same half second. So the
 * ceiling is the host's, and truncation is now reserved for a worktree that
 * genuinely exceeds it.
 */
const WORKTREE_FILE_LIMIT = FILE_LIST_LIMIT_MAX;

export interface WorktreeFiles {
  /** The agent's environment, for anything that reads files out of it. */
  environmentId: string | null;
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
    environmentId,
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
