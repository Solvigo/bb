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

/**
 * What the cursor carries while a file is being dragged.
 *
 * The browser's default is a ghost of the row that was grabbed — a slice of the
 * tree, in the tree's own colours, dragged over a composer it has nothing to do
 * with. What is actually being carried is a reference about to become a chip,
 * so the cursor carries a small card wearing the chat input's own background
 * and border: what you are dragging looks like where it is going.
 *
 * The node has to be IN the document for the browser to snapshot it, and must
 * outlive this call — the snapshot is taken after the handler returns — so it
 * is parked offscreen and removed on the next frame rather than immediately.
 */
export function setDragImageCard(
  dataTransfer: DataTransfer,
  path: string,
): void {
  if (typeof document === "undefined") return;
  const card = document.createElement("div");
  card.textContent = path.split("/").at(-1) ?? path;
  card.style.cssText = [
    "position:fixed",
    "top:-1000px",
    "left:-1000px",
    "max-width:260px",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "white-space:nowrap",
    "padding:6px 10px",
    "border-radius:10px",
    "font:500 12px/1.2 system-ui,sans-serif",
    "background:var(--tower-input,#1b1b1b)",
    "border:1px solid var(--tower-input-border,#333)",
    "color:var(--tower-fg-body,#e8e8e8)",
    "box-shadow:0 4px 12px rgba(0,0,0,0.35)",
  ].join(";");
  document.body.appendChild(card);
  dataTransfer.setDragImage(card, 12, 12);
  requestAnimationFrame(() => card.remove());
}
