import { atom } from "jotai";
import { atomFamily } from "jotai-family";

/**
 * Chat-link navigation (Phase 1 increment 3). The pilot writes a clickable
 * `bb-tower:` link in the commander chat; the chat's link handler parses it and
 * sets this shared atom; the right pane (ThreadSecondaryPanel) reads it and
 * navigates. The conversation becomes the navigation — push (the pilot links)
 * and pull (the operator clicks) over one channel.
 *
 * Links:
 *   bb-tower:brief           → what this agent was asked to do
 *
 * The set is the agent's tabs and nothing else. `crew`, `clearance`, and
 * `knowledge` were links here until those tabs were removed; a link to a tab
 * that no longer exists navigates nowhere and gives no reason, so it stops
 * parsing rather than silently doing nothing.
 */
export type TowerNavView = "brief";

export interface TowerNavRequest {
  /**
   * The thread whose panel this request targets. The atom is a single
   * fleet-wide slot — a split view can have more than one thread's panel
   * mounted at once — so every reader must check this against its own agent
   * id before acting; without it, a link in one thread's chat would navigate
   * every mounted panel that happens to be showing.
   */
  threadId: string;
  view: TowerNavView;
  /** bumped every request so repeat navigations to the same target re-fire */
  nonce: number;
}

export const towerNavAtom = atom<TowerNavRequest | null>(null);

/**
 * The highest tower-nav nonce a given thread's panel has already acted on.
 * Kept outside the component (in the Jotai store, not a ref) so a panel that
 * unmounts and remounts — a pane swap, a tab switch — does not re-read its own
 * blank slate and replay a navigation the operator already saw resolve.
 */
export const towerNavHandledNonceAtomFamily = atomFamily((_threadId: string) =>
  atom(0),
);

const PREFIX = "bb-tower:";

/**
 * Parse a href into a Tower nav request, or null if it is not a tower link.
 * The href carries no notion of which thread it was clicked in — the caller
 * (which does know) supplies `threadId` and `nonce` to complete the request.
 */
export function parseTowerLink(
  href: string,
): Omit<TowerNavRequest, "nonce" | "threadId"> | null {
  if (!href.startsWith(PREFIX)) return null;
  const rest = href.slice(PREFIX.length).replace(/^\/+/, "");
  if (rest === "brief") {
    return { view: rest };
  }
  return null;
}

let navCounter = 0;
export function nextNavNonce(): number {
  navCounter += 1;
  return navCounter;
}
