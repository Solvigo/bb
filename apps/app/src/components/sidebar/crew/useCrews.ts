import { useSyncExternalStore } from "react";
import { stripRankPrefix } from "@/lib/agent-title";
import { wsManager } from "@/lib/ws";

export interface CrewLead {
  threadId: string;
  name: string;
  /** the lead's own last report, when the crew plugin has one */
  status: string | null;
  working: boolean;
  /** commander | lead | sortie, straight from the plugin. Null when unranked. */
  rank: string | null;
  /**
   * What the instrument says, or null when it could not say. Deliberately not
   * folded into `working`: `working` is what the agent last REPORTED, liveness
   * is what it is actually doing, and collapsing the two would lose the case
   * where they disagree — which is the case worth seeing.
   */
  liveness: AgentLiveness | null;
  /**
   * The agents reporting to this one. Sorties under a lead, and — because the
   * thread tree has no depth limit — whatever reports to a sortie, nested
   * rather than dropped. An agent that exists and is not shown is the one
   * outcome an agent tree may not have.
   */
  sorties: CrewLead[];
}

export interface Crew {
  /** the commander thread — the root the Captain talks to */
  commanderThreadId: string;
  name: string;
  projectId: string;
  leads: CrewLead[];
  /** one line: what this crew is doing right now */
  status: string;
  /** The commander is an agent too — same instrument, same honesty about null. */
  liveness: AgentLiveness | null;
}

interface ThreadRow {
  id: string;
  title?: string | null;
  titleFallback?: string | null;
  projectId?: string;
  parentThreadId?: string | null;
}

/**
 * The verdict the crew plugin's instrument reached, or null when it could not
 * reach one. Null is NORMAL — it is loudly not a guess, and never means "idle".
 */
export interface AgentLiveness {
  verdict: string;
  at?: string | number | null;
}

interface FleetRow {
  threadId: string;
  handle: string | null;
  rank: string;
  liveness?: AgentLiveness | null;
}

interface BoardRow {
  threadId: string;
  report: { state: string; note: string } | null;
}

/** Strip substrate prefixes: the ranks are Commander, Lead and Sortie. */
function agentName(raw: string): string {
  return stripRankPrefix(raw);
}

/**
 * A read that always RESOLVES. A hung server is the case that matters: a fetch
 * that never settles never rejects either, so a catch block alone left the
 * sidebar reading "Reading the fleet…" for the life of the session. Observed
 * for real — the rig's server wedged and every crew call hung past 20s.
 */
const READ_TIMEOUT_MS = 8_000;

/**
 * The fleet read gets its own budget, because it stopped being a cheap call.
 * Per-row liveness needs a process-table read and a per-row event read, and the
 * call was measured at 18.2s cold, 7.4s, then 4.8s warm on a live rig — against
 * a shared 8s ceiling. The result was not an error anywhere: the read timed out,
 * the sidebar fell back to its threads-only paint, and every rank and verdict
 * silently went missing on exactly the cold load a person actually sees.
 *
 * The short ceiling stays where it earns its keep — the thread list, which
 * answers in ~40ms and whose hang is what left a spinner running for a session.
 */
const FLEET_READ_TIMEOUT_MS = 30_000;
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

async function crewRpc<T>(
  method: string,
  timeoutMs?: number,
): Promise<T | null> {
  const outcome = await readJson<{ ok?: boolean; result?: T }>(
    `/api/v1/plugins/crew/rpc/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    },
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
  const rankOf = new Map<string, string>();
  const livenessOf = new Map<string, AgentLiveness>();
  for (const r of fleet?.rows ?? []) {
    if (r.handle) handleOf.set(r.threadId, r.handle);
    if (r.rank) rankOf.set(r.threadId, r.rank);
    // Absent and null both mean "no verdict": the map simply has no entry, so
    // a reader cannot mistake a missing verdict for a quiet one.
    if (r.liveness) livenessOf.set(r.threadId, r.liveness);
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

  // Walk down from an agent rather than one level: the ranks the product names
  // stop at sortie, but the thread tree does not, and a fixed two-level read
  // would silently hide anything deeper.
  const agentsUnder = (
    parentId: string,
    seen = new Set<string>(),
  ): CrewLead[] =>
    (byParent.get(parentId) ?? [])
      .filter((t) => live.has(t.id) && !seen.has(t.id))
      .map((t) => {
        seen.add(t.id);
        const report = reportOf.get(t.id) ?? null;
        return {
          threadId: t.id,
          name: agentName(handleOf.get(t.id) ?? titleOf(t)),
          status: report?.note ?? null,
          working: report?.state === "working",
          rank: rankOf.get(t.id) ?? null,
          liveness: livenessOf.get(t.id) ?? null,
          sorties: agentsUnder(t.id, seen),
        };
      });

  return threads
    .filter((t) => !t.parentThreadId && live.has(t.id))
    .map((commander) => {
      const leads: CrewLead[] = agentsUnder(commander.id);
      const working = leads.filter((l) => l.working).length;
      return {
        commanderThreadId: commander.id,
        name: titleOf(commander),
        projectId: commander.projectId ?? "",
        liveness: livenessOf.get(commander.id) ?? null,
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
    crewRpc<{ rows: FleetRow[] }>(
      "crew_fleet",
      Math.max(timeoutMs, FLEET_READ_TIMEOUT_MS),
    ),
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
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  return { ...snapshot, reload: reloadCrews };
}
