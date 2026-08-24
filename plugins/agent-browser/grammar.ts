/**
 * Every verb, field and route NAME this surface puts on the wire, in one place.
 *
 * bb's own `bb browser` grammar (plans/bb-browser.md, Phase 1) is the authority
 * for the names that exist there, so this file conforms to them. Where a name
 * is genuinely undecided upstream it is defined here and marked
 * PROPOSE-UPSTREAM, so converging later is a one-line edit in this file rather
 * than a sweep through routes, contracts, tests and clients.
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
  /** bb: `bb browser close <target-id>`. */
  close: "close",
} as const;

/**
 * bb's target-ownership model (plans/bb-browser.md, Phase 1). `visible` is
 * derived here, not accepted: a streamed session is visible exactly while at
 * least one viewer holds its frame stream open.
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

export type CreatedBy = (typeof CREATED_BY)[keyof typeof CREATED_BY];

/**
 * PROPOSE-UPSTREAM: bb's grammar exposes `click`/`type` as verbs over a
 * selector. A watched stream sends raw pointer and key events at viewport
 * coordinates instead — there is no selector on the operator's end of an
 * MJPEG frame — so this surface carries an input channel and bb's two verbs
 * become clients of it.
 */
export const INPUT_KIND = {
  mouse: "mouse",
  key: "key",
  text: "text",
} as const;

/**
 * Mounted under `/api/v1/plugins/<id>/http`.
 *
 * PROPOSE-UPSTREAM: bb dispatches plugin routes on an exact method+path match
 * (apps/server/src/services/plugins/plugin-service.ts, `getHttpRoute`), so a
 * path parameter — `/sessions/:threadId/stream` — never matches anything. The
 * thread therefore rides the query string; if plugin routes gain path
 * parameters, these two constants are the whole change.
 */
export const HTTP_ROUTE = {
  stream: "/sessions/stream",
  input: "/sessions/input",
} as const;

export const QUERY_PARAM = {
  threadId: "threadId",
} as const;

/**
 * PROPOSE-UPSTREAM: the agent-facing command name. bb's plan claims the core
 * `bb browser` namespace for the desktop-composited browser, so this plugin
 * does not squat it; the intended convergence is one `bb browser` grammar over
 * two backends (desktop-native and web-streamed-per-agent).
 */
export const CLI_COMMAND = "agent-browser";
