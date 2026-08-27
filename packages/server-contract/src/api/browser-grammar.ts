/**
 * Wire names shared with bb-plugins/agent-browser/src/grammar.mjs — one grammar,
 * two backends (desktop-native and web-streamed-per-agent).
 */

export const BROWSER_VERB = {
  /** bb: `bb browser open <url>` — make this thread a page and load a url. */
  open: "open",
  /**
   * PROPOSE-UPSTREAM: bb's grammar has no `navigate` — it re-opens instead.
   * This surface holds exactly one page per thread, so "load a url in the page
   * that already exists" is a different act from "make me a page", and the
   * caller wants to be told when the page it meant to drive is gone.
   */
  navigate: "navigate",
  /**
   * bb: `bb browser snapshot <target-id>`. PROPOSE-UPSTREAM: bb's plan does not
   * fix the payload, so {url, title, text} is ours (pixels already ride the
   * frame stream, so a snapshot deliberately carries no screenshot).
   */
  snapshot: "snapshot",
  /** bb: `bb browser list` — enumerate automation targets in scope. */
  list: "list",
  /** bb: `bb browser click <target-id> (--selector S | --x N --y N)`. */
  click: "click",
  /** bb: `bb browser type <target-id> --selector S --text T`. */
  type: "type",
  /** bb: `bb browser eval <target-id> --script-file F` (script string at wire). */
  eval: "eval",
  /** bb: `bb browser close <target-id>`. */
  close: "close",
} as const;

export type BrowserVerb = (typeof BROWSER_VERB)[keyof typeof BROWSER_VERB];

/**
 * bb's target-ownership model (plans/bb-browser.md, Phase 1). `visible` is
 * derived server-side, not accepted from clients.
 */
export const TARGET_FIELD = {
  targetId: "targetId",
  threadId: "threadId",
  createdBy: "createdBy",
  visible: "visible",
  createdAt: "createdAt",
  lastUsedAt: "lastUsedAt",
} as const;

export const CREATED_BY = {
  cli: "cli",
  agent: "agent",
} as const;

export type BrowserCreatedBy = (typeof CREATED_BY)[keyof typeof CREATED_BY];

/** Header carrying the caller's BB_THREAD_ID when present. */
export const BB_CALLER_THREAD_ID_HEADER = "x-bb-thread-id";
