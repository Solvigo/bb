import { PERSONAL_PROJECT_ID } from "@bb/domain";

/**
 * The roots THIS client stood up and has not yet seen chartered.
 *
 * A half-made root has to be told apart from an ordinary conversation, and a
 * title cannot do it: "New crew" is a sentence anyone may name a chat, and
 * reading provenance off it classifies the operator's own thinking as a broken
 * setup. So the flow records what it created, keyed by the exact thread id and
 * the project it was created on.
 *
 * This is a note about what this client did, never a source of truth about
 * what a thread IS. Every read is validated against the live fleet — still a
 * root, still without a handle, still on the project it was recorded for — so
 * a record that has gone stale simply stops matching.
 */
const STORAGE_KEY = "bb.crew.standby-roots";

export interface StandbyRoot {
  threadId: string;
  projectId: string;
}

/** One spelling of the projectless project, here and in the flow. */
function normalizeProjectId(projectId: string | null | undefined): string {
  return projectId === null || projectId === undefined || projectId === ""
    ? PERSONAL_PROJECT_ID
    : projectId;
}

function parse(raw: string | null): StandbyRoot[] {
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  // A malformed entry is dropped rather than poisoning the file: this is a
  // convenience note, and the worst an unreadable one may cost is a retry
  // affordance.
  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.threadId !== "string" || e.threadId === "") return [];
    if (typeof e.projectId !== "string" || e.projectId === "") return [];
    return [{ threadId: e.threadId, projectId: e.projectId }];
  });
}

function readAll(): StandbyRoot[] {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // A private window, cleared site data, a browser that refuses storage.
    return [];
  }
}

function writeAll(entries: StandbyRoot[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Record a standby BEFORE it exists, and say so if the note cannot be kept.
 *
 * Throws rather than shrugging. Without the record there is nothing that can
 * tell this thread from an ordinary chat afterwards — no retry, no cleanup,
 * and a half-made root indistinguishable from the operator's own writing. A
 * crew that was never created is recoverable; an unidentifiable one is not.
 */
export function rememberStandbyRoot(threadId: string, projectId: string): void {
  const entries = readAll().filter((e) => e.threadId !== threadId);
  entries.push({ threadId, projectId: normalizeProjectId(projectId) });
  writeAll(entries);
}

export function forgetStandbyRoot(threadId: string): void {
  try {
    writeAll(readAll().filter((e) => e.threadId !== threadId));
  } catch {
    // Losing the removal costs a stale note, which the next read discards.
  }
}

/** What this client believes it left half-made, as {threadId: projectId}. */
export function recordedStandbyRoots(): ReadonlyMap<string, string> {
  return new Map(readAll().map((e) => [e.threadId, e.projectId]));
}

/**
 * Drop every note the live rig no longer agrees with.
 *
 * A thread that was deleted, chartered, reparented under someone, or moved to
 * another project is not a standby of ours any more. Left in place those notes
 * accumulate forever and keep answering questions about threads that no longer
 * match them.
 */
export function purgeStandbyRoots(
  live: readonly { id: string; projectId?: string; parentThreadId?: string | null }[],
  handled: ReadonlySet<string>,
): void {
  const byId = new Map(live.map((t) => [t.id, t]));
  const kept = readAll().filter((entry) => {
    const thread = byId.get(entry.threadId);
    if (thread === undefined) return false;
    if (thread.parentThreadId) return false;
    if (handled.has(entry.threadId)) return false;
    return normalizeProjectId(thread.projectId) === entry.projectId;
  });
  try {
    writeAll(kept);
  } catch {
    // Same as forget: a note that cannot be removed is discarded on read.
  }
}
