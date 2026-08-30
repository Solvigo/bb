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
 * a record that has gone stale, or that describes a thread someone else has
 * since chartered, moved or deleted, simply stops matching.
 */
const STORAGE_KEY = "bb.crew.standby-roots";

export interface StandbyRoot {
  threadId: string;
  projectId: string;
}

function readAll(): StandbyRoot[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is StandbyRoot => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return typeof e.threadId === "string" && typeof e.projectId === "string";
    });
  } catch {
    // A private window, cleared site data, a browser that refuses storage: the
    // honest answer is "this client remembers nothing", never a crash on a
    // path whose job is to stand up a crew.
    return [];
  }
}

function writeAll(entries: StandbyRoot[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Losing the note costs the retry affordance, not the crew.
  }
}

export function rememberStandbyRoot(
  threadId: string,
  projectId: string,
): void {
  const entries = readAll().filter((e) => e.threadId !== threadId);
  entries.push({ threadId, projectId });
  writeAll(entries);
}

export function forgetStandbyRoot(threadId: string): void {
  writeAll(readAll().filter((e) => e.threadId !== threadId));
}

/** What this client believes it left half-made, as {threadId: projectId}. */
export function recordedStandbyRoots(): ReadonlyMap<string, string> {
  return new Map(readAll().map((e) => [e.threadId, e.projectId]));
}
