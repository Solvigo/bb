/**
 * The drag type a worktree file row carries.
 *
 * Plain text rides along beside it so a drop anywhere else — a terminal, an
 * editor, another app — still gets something useful. This type is what tells
 * the composer the text is a FILE REFERENCE rather than a sentence, which is
 * the difference between a mention pill and a path spelled out.
 */
export const WORKTREE_PATH_DRAG_TYPE = "application/x-bb-worktree-path";

export function readWorktreePathDrag(
  dataTransfer: DataTransfer | null,
): string | null {
  if (!dataTransfer) return null;
  if (!dataTransfer.types.includes(WORKTREE_PATH_DRAG_TYPE)) return null;
  const path = dataTransfer.getData(WORKTREE_PATH_DRAG_TYPE).trim();
  return path === "" ? null : path;
}
