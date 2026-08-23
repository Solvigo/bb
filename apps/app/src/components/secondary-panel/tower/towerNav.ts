import { atom } from "jotai";

/**
 * Chat-link navigation (Phase 1 increment 3). The pilot writes a clickable
 * `bb-tower:` link in the commander chat; the chat's link handler parses it and
 * sets this shared atom; the right pane (ThreadSecondaryPanel + FleetOverviewTab)
 * reads it and navigates. The conversation becomes the navigation — push (the
 * pilot links) and pull (the operator clicks) over one channel.
 *
 * Links:
 *   bb-tower:crew            → the fleet board
 *   bb-tower:clearance       → yours to clear
 *   bb-tower:sp/<threadId>   → drill into that SP (board + its focus view)
 */
export type TowerNavView = "crew" | "clearance";

export interface TowerNavRequest {
  view: TowerNavView;
  /** when set, open this SP's focus view (implies the crew surface) */
  spThreadId?: string;
  /** bumped every request so repeat navigations to the same target re-fire */
  nonce: number;
}

export const towerNavAtom = atom<TowerNavRequest | null>(null);

const PREFIX = "bb-tower:";

/** Parse a href into a Tower nav request, or null if it is not a tower link. */
export function parseTowerLink(href: string): Omit<TowerNavRequest, "nonce"> | null {
  if (!href.startsWith(PREFIX)) return null;
  const rest = href.slice(PREFIX.length).replace(/^\/+/, "");
  if (rest.startsWith("sp/")) {
    const id = rest.slice(3).trim();
    return id ? { view: "crew", spThreadId: id } : null;
  }
  if (rest === "crew" || rest === "clearance") {
    return { view: rest };
  }
  return null;
}

let navCounter = 0;
export function nextNavNonce(): number {
  navCounter += 1;
  return navCounter;
}
