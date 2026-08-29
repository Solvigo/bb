// Shared geometry for drawing the fleet board as a tree: how far a row
// indents, where its rail and elbow sit, and how much air separates it from
// the row before it. Kept pure and separate from FleetOverviewTab so the
// numbers can be verified without mounting the board.

// Matches the sidebar tree's rail spacing (#53) so the two trees read as one
// visual language.
export const RAIL_WIDTH = 22;
export const RAIL_OFFSET = 10;

// Past this depth, indentation grows slower so an unusually deep chain of
// command still fits the panel instead of running the tree off the right
// edge.
const FULL_RAIL_DEPTH = 5;
const DEEP_STEP = 8;

export function railIndentPx(depth: number): number {
  if (depth <= FULL_RAIL_DEPTH) return depth * RAIL_WIDTH;
  return FULL_RAIL_DEPTH * RAIL_WIDTH + (depth - FULL_RAIL_DEPTH) * DEEP_STEP;
}

export function railLeftPx(level: number): number {
  return railIndentPx(level) + RAIL_OFFSET;
}

export function elbowGeometry(depth: number): { left: number; width: number } {
  const left = railLeftPx(depth - 1);
  return { left, width: Math.max(4, railIndentPx(depth) - left) };
}

// Vertical position of the elbow that connects a row's rail to its card —
// half the header's min-h-14 (56px), so it lands on the identity icon's
// center regardless of that icon's depth-scaled size.
export const ELBOW_TOP_PX = 28;

export function ariaLevelFor(depth: number): number {
  return depth + 1;
}

export type FamilySpacing = "family" | "branch" | "sibling";

/**
 * Vertical rhythm between one row and the row before it, read off how a
 * depth-first walk moves between them: landing back on a root starts a new
 * family, dropping back up the tree (without returning to a root) starts a
 * new branch, and everything else — descending into children or moving to
 * the next sibling — stays part of the same tight group.
 */
export function spacingBetween(
  depth: number,
  previousDepth: number | null,
): FamilySpacing {
  if (previousDepth === null) return "sibling";
  if (depth === 0) return "family";
  if (depth < previousDepth) return "branch";
  return "sibling";
}

export const FAMILY_SPACING_CLASS: Record<FamilySpacing, string> = {
  family: "mt-6",
  branch: "mt-3",
  sibling: "mt-1.5",
};
