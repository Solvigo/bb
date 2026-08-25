import { useSyncExternalStore } from "react";
import { wsManager } from "@/lib/ws";

export interface CrewLead {
  threadId: string;
  name: string;
  /** the lead's own last report, when the crew plugin has one */
  status: string | null;
  working: boolean;
}

export interface Crew {
  /** the commander thread — the root the Captain talks to */
  commanderThreadId: string;
  name: string;
  projectId: string;
  leads: CrewLead[];
  /** one line: what this crew is doing right now */
  status: string;
}

interface ThreadRow {
  id: string;
  title?: string | null;
  titleFallback?: string | null;
  projectId?: string;
  parentThreadId?: string | null;
}

interface FleetRow {
  threadId: string;
  handle: string | null;
  rank: string;
}

interface BoardRow {
  threadId: string;
  report: { state: string; note: string } | null;
}

/** Strip substrate prefixes: the ranks are Commander, Lead and Sortie. */
function agentName(raw: string): string {
  return raw.replace(/^(sp|plt|cm)[\s·-]+/i, "").replace(/^(sp|plt|cm)[-_]/i, "");
}

/**
 * A read that always RESOLVES. A hung server is the case that matters: a fetch
 * that never settles never rejects either, so a catch block alone left the
 * sidebar reading "Reading the fleet…" for the life of the session. Observed
 * for real — the rig's server wedged and every crew call hung past 20s.
 */
const READ_TIMEOUT_MS = 8_000;
/**
 * A retry gets more patience than the first attempt. Retrying a TIMEOUT with
 * the same patience is theatre: the button does exactly what already failed and
 * the operator learns nothing. This machine also runs the fleet's CI, so a slow
 * answer is a normal condition here, not a broken one.
 */
const RETRY_TIMEOUT_MS = 25_000;

type ReadOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "timeout" | "error" };

async function readJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs: number = READ_TIMEOUT_MS,
): Promise<ReadOutcome<T>> {
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: abort.signal });
    if (!res.ok) return { ok: false, reason: "error" };
    return { ok: true, value: (await res.json()) as T };
  } catch {
    // A server that is merely SLOW and one that is broken need different words
    // and different remedies, and collapsing them cost a real diagnosis: an
    // eight-second cutoff on a loaded box reads as "couldn't read the fleet"
    // when the honest answer is "it hasn't answered yet".
    return { ok: false, reason: timedOut ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

async function crewRpc<T>(method: string, timeoutMs?: number): Promise<T | null> {
  const outcome = await readJson<{ ok?: boolean; result?: T }>(
    `/api/v1/plugins/crew/rpc/${method}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "null" },
    timeoutMs,
  );
  return outcome.ok ? (outcome.value.result ?? null) : null;
}

/**
 * Fold the thread tree and the crew plugin's two views into crews. Pure, and
 * tolerant of either plugin view being absent: called once with the thread list
 * alone so crews paint immediately, then again once the plugin answers.
 */
function assembleCrews(
  threads: ThreadRow[],
  fleet: { rows: FleetRow[] } | null,
  board: { rows: BoardRow[] } | null,
): Crew[] {
  const live = new Set(threads.map((t) => t.id));
  const handleOf = new Map<string, string>();
  for (const r of fleet?.rows ?? []) {
    if (r.handle) handleOf.set(r.threadId, r.handle);
  }
  const reportOf = new Map<string, { state: string; note: string } | null>();
  for (const b of board?.rows ?? []) reportOf.set(b.threadId, b.report);

  // A commander is a live root thread; its leads are live children.
  const byParent = new Map<string, ThreadRow[]>();
  for (const t of threads) {
    if (!t.parentThreadId) continue;
    const list = byParent.get(t.parentThreadId) ?? [];
    list.push(t);
    byParent.set(t.parentThreadId, list);
  }

  const titleOf = (t: ThreadRow) =>
    agentName((t.title ?? t.titleFallback ?? t.id).trim());

  return threads
    .filter((t) => !t.parentThreadId && live.has(t.id))
    .map((commander) => {
      const leads: CrewLead[] = (byParent.get(commander.id) ?? [])
        .filter((t) => live.has(t.id))
        .map((t) => {
          const report = reportOf.get(t.id) ?? null;
          return {
            threadId: t.id,
            name: agentName(handleOf.get(t.id) ?? titleOf(t)),
            status: report?.note ?? null,
            working: report?.state === "working",
          };
        });
      const working = leads.filter((l) => l.working).length;
      return {
        commanderThreadId: commander.id,
        name: titleOf(commander),
        projectId: commander.projectId ?? "",
        leads,
        status:
          leads.length === 0
            ? "no leads yet"
            : working > 0
              ? `${working} of ${leads.length} working`
              : `${leads.length} lead${leads.length === 1 ? "" : "s"} standing by`,
      };
    });
}

/**
 * The crews on this rig, assembled for a crew-centric sidebar.
 *
 * A CREW is a commander thread plus the leads reporting to it. The thread list
 * gives the shape (who is whose parent); the crew plugin gives the ranks and
 * each lead's own last report, so a row can say what its lead is doing rather
 * than just naming it. Live off the crew signal and thread changes.
 */
export interface CrewsState {
  crews: Crew[];
  /** false only until the first attempt resolves — never a permanent state */
  loaded: boolean;
  /** the last attempt could not read the fleet; `crews` is the last known set */
  failed: boolean;
  /** the attempt ran out of patience rather than being refused */
  timedOut: boolean;
  reload: () => void;
}

/**
 * ONE fleet read, shared by every surface that asks.
 *
 * Each caller used to own its own fetch and its own `loaded` flag, and that is
 * not merely wasteful — it lets two surfaces disagree about the same fact at
 * the same instant. The home screen and the rail did exactly that in front of
 * the Captain: the rail listed a crew and its leads while the home beside it
 * said "No crews yet", because the home's second, younger copy of this hook had
 * not finished reading yet. Two reads of one truth is two truths.
 */
let state: CrewsSnapshot = {
  crews: [],
  loaded: false,
  failed: false,
  timedOut: false,
};
const subscribers = new Set<() => void>();
let started = false;
let disposeSources: (() => void) | null = null;

interface CrewsSnapshot {
  crews: Crew[];
  loaded: boolean;
  failed: boolean;
  /** Set when the last attempt ran out of patience rather than being refused. */
  timedOut: boolean;
}

function publish(next: CrewsSnapshot): void {
  state = next;
  for (const notify of subscribers) notify();
}

async function loadOnce(timeoutMs: number = READ_TIMEOUT_MS): Promise<void> {
  const outcome = await readJson<unknown>(
    "/api/v1/threads?archived=false",
    undefined,
    timeoutMs,
  );
  // A read that fails still RESOLVES the question: a surface must be able to
  // say what happened. Returning early here left `loaded` false for the life of
  // the session, so one failed fetch showed a spinner that never stopped — a
  // hang is a lie in the same way invented data is. Whatever went wrong, the
  // crews already known are KEPT: a failed refresh is not evidence the fleet
  // went away.
  if (!outcome.ok) {
    publish({
      ...state,
      loaded: true,
      failed: true,
      timedOut: outcome.reason === "timeout",
    });
    return;
  }
  const raw = outcome.value;
  const threads = (
    Array.isArray(raw)
      ? raw
      : ((raw as { threads?: unknown[] }).threads ??
        (raw as { data?: unknown[] }).data ??
        [])
  ) as ThreadRow[];

  // Publish the moment the SHAPE is known. The thread list answers in ~40ms;
  // the plugin's rank and report calls take the best part of a second between
  // them, and waiting on both put a spinner in front of data already in hand.
  // Ranks and working states settle in a second pass — until they do, a lead
  // reads as standing by rather than being guessed at.
  publish({
    crews: assembleCrews(threads, null, null),
    loaded: true,
    failed: false,
    timedOut: false,
  });

  const [fleet, board] = await Promise.all([
    crewRpc<{ rows: FleetRow[] }>("crew_fleet", timeoutMs),
    crewRpc<{ rows: BoardRow[] }>("crew_board", timeoutMs),
  ]);
  publish({
    crews: assembleCrews(threads, fleet, board),
    loaded: true,
    failed: false,
    timedOut: false,
  });
}

function startSources(): void {
  if (started) return;
  started = true;
  void loadOnce();
  const offSignal = wsManager.onPluginSignal((s) => {
    if (s.pluginId === "crew") void loadOnce();
  });
  const offChanged = wsManager.onChanged((m) => {
    if (m.entity === "thread") void loadOnce();
  });
  disposeSources = () => {
    offSignal();
    offChanged();
    started = false;
    disposeSources = null;
  };
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  startSources();
  return () => {
    subscribers.delete(notify);
    // The last surface let go: stop listening, but KEEP the snapshot. The next
    // surface to mount shows the fleet it already knows about and refreshes
    // underneath, instead of flashing an empty fleet it has no reason to claim.
    if (subscribers.size === 0) disposeSources?.();
  };
}

export function reloadCrews(): void {
  void loadOnce(RETRY_TIMEOUT_MS);
}

export function useCrews(): CrewsState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  return { ...snapshot, reload: reloadCrews };
}
