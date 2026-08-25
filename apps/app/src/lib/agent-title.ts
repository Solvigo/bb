/** Stored titles and crew handles from the old era carry a substrate rank prefix
 *  ("SP · x", "cm_y"). The ranks the operator sees are Commander, Lead and Sortie.
 *
 *  The server strips the same prefix off every thread DTO it emits — keep this
 *  regex identical to `stripRankPrefix` in
 *  `apps/server/src/services/threads/thread-runtime-display.ts`. Crew-plugin
 *  handles never pass through that seam, which is why this copy still exists. */
export function stripRankPrefix(raw: string): string {
  return raw.replace(/^(sp|plt|cm)[\s·_-]+/i, "");
}
