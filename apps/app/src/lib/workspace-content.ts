/**
 * WHAT ONE WORKSPACE SURFACE IS SHOWING — the route's own content model.
 *
 * CARVE PHASE 2: this type used to live in `lib/split-layout/types.ts` as `PaneContent`, and it does
 * not belong to splitting. It is the answer to "what did the URL ask for" — a thread, the compose
 * screen, or a plugin panel — which every workspace surface needs whether or not panes exist. The
 * split model went; this stayed, under a name that says what it actually is.
 *
 * The name `PaneContent` survives as an alias on purpose: it is what the remaining consumers call it
 * and what the deleted layer called it, so a reader following either trail lands here rather than on a
 * missing symbol.
 */
export type WorkspaceContent =
  | { kind: "thread"; projectId: string; threadId: string }
  | { kind: "new-thread" }
  | { kind: "plugin-panel"; pluginId: string; panelPath: string; subPath: string };

/** @deprecated the split-era name; kept so both trails lead to one type. */
export type PaneContent = WorkspaceContent;

/** The compose surface, as content. Was `ROOT_COMPOSE_CONTENT` in the split layer's ops. */
export const ROOT_COMPOSE_CONTENT: WorkspaceContent = { kind: "new-thread" };

/** One thread, as content. */
export function threadContent(args: { projectId: string; threadId: string }): WorkspaceContent {
  return { kind: "thread", projectId: args.projectId, threadId: args.threadId };
}
