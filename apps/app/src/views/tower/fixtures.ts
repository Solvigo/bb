/**
 * Increment 1 — the Tower Shell renders from static fixtures only. No fleet
 * instance is read (outside-only rule). Shapes mirror the crew plugin ledger
 * so the real data API can drop in later without reshaping the view:
 *   - crew_work_items: task_id, title, intent, acceptance, brief, state, ordering
 *   - crew_standing:  one row per thread — a self-authored status line + updated_at
 */

export type WorkItemState =
  | "queued"
  | "in_flight"
  | "in_review"
  | "accepted"
  | "dropped";

export interface WorkItem {
  taskId: string;
  title: string;
  state: WorkItemState;
}

export interface Lane {
  id: string;
  /** Airways rank code — cosmetic label only. */
  rank: "SP" | "CM";
  name: string;
  /** kind slug for the domain the SP owns */
  domain: string;
  /** self-authored status line ("what is on my mind, right now") */
  statusLine: string;
  /** minutes since the line was stamped */
  statusAgeMin: number;
  /** minutes since the lane last produced any activity */
  lastActivityMin: number;
  focus: string;
  next: string | null;
  items: WorkItem[];
}

/** A demand on the CLEARANCE surface — pilot-ranked, only #1 wears the accent. */
export interface ClearanceItem {
  id: string;
  rank: number;
  title: string;
  /** the one-line rationale — a demand is refused without one */
  rationale: string;
  fromLane: string;
  vetted: boolean;
  kind: "decision" | "look" | "credential" | "blocker";
  detail: {
    whatWasDone: string;
    result: string;
    prUrl?: string;
    sealedSha?: string;
    ask: string;
  };
}

export interface ChatMessage {
  id: string;
  author: "commander" | "pilot";
  text: string;
  atMin: number;
}

export const PILOT = {
  name: "harness pilot",
  domain: "bb buildout",
  statusLine: "Increment 1 is on your loop — Tower shell, fixture data. Your eye next.",
};

export const LANES: Lane[] = [
  {
    id: "tower",
    rank: "SP",
    name: "tower",
    domain: "UI buildout",
    statusLine: "Building the Tower shell — left chat, right tabbed stack — against the blueprint greys.",
    statusAgeMin: 1,
    lastActivityMin: 1,
    focus: "Increment 1: the shell, static, on the live loop.",
    next: "Wire the real ThreadChat mount once the shell reads true.",
    items: [
      { taskId: "tower-shell-1", title: "Tower shell — overview + clearance tabs", state: "in_flight" },
      { taskId: "tower-greys", title: "Tower greys measured from blueprint", state: "in_review" },
      { taskId: "tower-live-loop", title: "Stand up the permanent live loop", state: "accepted" },
    ],
  },
  {
    id: "prime",
    rank: "SP",
    name: "prime",
    domain: "product",
    statusLine: "Holding — nothing lands until the buildout plan is ratified.",
    statusAgeMin: 6,
    lastActivityMin: 6,
    focus: "Standing by on the product surface.",
    next: null,
    items: [{ taskId: "prime-hold", title: "Await buildout plan", state: "queued" }],
  },
  {
    id: "clearance",
    rank: "SP",
    name: "clearance",
    domain: "the gate",
    statusLine: "Attention router quiet — one look-judgement waiting on the Commander.",
    statusAgeMin: 3,
    lastActivityMin: 3,
    focus: "Route what needs the Commander, and only that.",
    next: "Seal the shell increment's PR once approved.",
    items: [
      { taskId: "clr-router", title: "Attention router — decisions route", state: "in_flight" },
      { taskId: "clr-seal", title: "Boarding-pass seal on work-item PRs", state: "in_review" },
    ],
  },
  {
    id: "knowledge",
    rank: "SP",
    name: "knowledge",
    domain: "current truth",
    // Deliberately stale: the line was stamped 47m ago, but the lane produced
    // activity only 8m ago — so the line is older than the agent's last move and
    // is marked stale rather than trusted.
    statusLine: "Curating theme:harness — folding the liveness-law revisions into the summary.",
    statusAgeMin: 47,
    lastActivityMin: 8,
    focus: "Keep one head per subject; curation debt under 20.",
    next: "Re-curate the theme summary before the next accept.",
    items: [
      { taskId: "kn-summary", title: "Re-curate theme summary (curation due)", state: "queued" },
    ],
  },
];

/** Unowned work — the one QUEUE strip. */
export const QUEUE: WorkItem[] = [
  { taskId: "q-rename", title: "Rename the gate plugin → clearance", state: "queued" },
  { taskId: "q-statusline", title: "Per-turn status-line hook (crew_standing)", state: "queued" },
];

export const CLEARANCE: ClearanceItem[] = [
  {
    id: "clr-1",
    rank: 1,
    title: "Tower shell increment 1 — look judgement",
    rationale: "First visual increment; your eye is the gate before the next one.",
    fromLane: "tower",
    vetted: true,
    kind: "look",
    detail: {
      whatWasDone:
        "Built the Tower shell on the live loop: left pilot-chat column (darkest grey), right tabbed stack — Overview (all crew + status lines) and Clearance (this surface, master-detail).",
      result:
        "Renders from fixtures on the loop; tower greys measured from the blueprint; one warm accent on attention only; honest empties throughout.",
      prUrl: "— not yet; nothing lands until you clear it",
      sealedSha: "—",
      ask: "Does the shell read true to the blueprint? Annotate anything wrong before increment 2.",
    },
  },
  {
    id: "clr-2",
    rank: 2,
    title: "Confirm the clearance rename",
    rationale: "Vocabulary lines up the whole plan; wanted before the buildout crew is briefed.",
    fromLane: "clearance",
    vetted: true,
    kind: "decision",
    detail: {
      whatWasDone:
        "Proposed renaming the gate plugin to 'clearance' — the code already speaks it (boarding passes, cleared to land).",
      result: "Awaiting your word to join the rename to the plan.",
      ask: "Say the word and the rename joins the plan.",
    },
  },
  {
    id: "clr-3",
    rank: 3,
    title: "Standing authority for routine landings",
    rationale: "Lets agent-to-agent traffic flow without reaching your desk.",
    fromLane: "clearance",
    vetted: false,
    kind: "decision",
    detail: {
      whatWasDone:
        "Drafted a standing-authority grant so the pilot can land routine work in your name, ledger recording who approved and under what authority.",
      result: "Draft only — not vetted yet.",
      ask: "Grant standing authority for routine landings, or keep each one on your desk?",
    },
  },
];

export const CHAT: ChatMessage[] = [
  { id: "m1", author: "commander", text: "The ui changes done just now are very far from my idea.", atMin: 62 },
  { id: "m2", author: "pilot", text: "Understood. Holding everything; we plan the look together first, and your eye gates each increment.", atMin: 60 },
  { id: "m3", author: "commander", text: "Good. Stand up a live loop I can watch, and start with the shell.", atMin: 40 },
  { id: "m4", author: "pilot", text: "Loop is up. Increment 1 — the Tower shell — is on it now with fixture data: chat left, the tabbed stack right. Your eye next.", atMin: 1 },
];
