import { useSyncExternalStore } from "react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { stripRankPrefix } from "@/lib/agent-title";
import { wsManager } from "@/lib/ws";
import { recordedStandbyRoots } from "./standbyRoots";

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
  /**
   * Items waiting on the OPERATOR, on this agent and everything below it.
   *
   * Rolled up rather than per-row, because the pilot is where the Captain looks
   * first and an ask two levels down that shows nowhere until he happens to
   * expand the right branch is an ask he never sees. Drilling in narrows the
   * number to that subtree, which is how the count stays honest at every level.
   */
  attention: number;
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
  /** Waiting on the operator, on the commander and its whole crew. */
  attention: number;
}

/**
 * A thread nobody has crewed: no agents under it and no crew handle. Defined by
 * ABSENCE, exactly as the model intends — there is no second kind of thread,
 * and any of these can be chartered later without moving.
 */
/** The title a root carries from creation until its crew names it. It names
 *  the thread and nothing more — provenance is recorded, never inferred from
 *  a sentence anyone is free to write. */
export const ROOT_THREAD_TITLE = "New crew";

/**
 * A root that was created for a crew and never chartered.
 *
 * It is not a chat — nobody started it to talk in — and it is not a crew,
 * because the charter that would have made it one did not go through. Kept as
 * its own kind so it renders inside its project with a retry rather than
 * settling into Chats, where it would both look like a conversation and, by
 * counting as the project's root, hide the affordance that could fix it.
 */
export interface PendingRoot {
  threadId: string;
  name: string;
  projectId: string;
}

export interface LooseChat {
  threadId: string;
  name: string;
  projectId: string;
  liveness: AgentLiveness | null;
}

/**
 * One thing waiting on somebody. Only `operator` items count here: an ask
 * routed to another AGENT is not the Captain's to clear, and counting it would
 * put a number on his screen that nothing he does removes.
 */
interface AttentionRow {
  threadId?: string | null;
  audience?: string | null;
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
  /**
   * What the row IS. A `deck` is not an agent at all — it is a thread the crew
   * plugin spawns to display decision cards, and it was appearing here as a
   * lead because rank is derived from parentage and a deck is parented exactly
   * like one.
   *
   * ABSENT MEANS AGENT, deliberately: an older plugin sends no kind, and a
   * missing field must never make real crew disappear from the rail. Only an
   * explicit `deck` is filtered.
   */
  kind?: string | null;
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
/**
 * Moves the operator has made but the server has not confirmed yet.
 *
 * A drag has to look instant or it does not feel like dragging, so the row
 * moves on drop and this remembers where it was put. It is cleared either way
 * — on success the next read carries the same shape, and on refusal the row
 * springs back to where the server still says it belongs.
 */
const pendingParents = new Map<string, string | null>();

export function assembleFleet(
  threads: ThreadRow[],
  fleet: { rows: FleetRow[] } | null,
  board: { rows: BoardRow[] } | null,
  attention: { open?: AttentionRow[] } | null,
  artifacts: { artifacts?: AttentionRow[] } | null,
): { crews: Crew[]; chats: LooseChat[]; pendingRoots: PendingRoot[] } {
  // Decks leave the tree before anything else looks at it, so every downstream
  // question — who is crewed, what is under whom, what is waiting on the
  // operator — is answered as if they were never there. Filtering them later,
  // at the render, would have left them counted in all three.
  const deckIds = new Set(
    (fleet?.rows ?? []).filter((r) => r.kind === "deck").map((r) => r.threadId),
  );
  const agentThreads =
    deckIds.size === 0 ? threads : threads.filter((t) => !deckIds.has(t.id));
  const live = new Set(agentThreads.map((t) => t.id));
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
  // What is waiting on the operator, per agent, before any rolling up. An item
  // with no thread on it belongs to nobody on this tree and is left out rather
  // than attributed to a guess.
  const asksOf = new Map<string, number>();
  for (const item of [
    ...(attention?.open ?? []),
    ...(artifacts?.artifacts ?? []),
  ]) {
    if (item.audience !== undefined && item.audience !== "operator") continue;
    const id = item.threadId;
    if (typeof id !== "string" || id === "") continue;
    asksOf.set(id, (asksOf.get(id) ?? 0) + 1);
  }

  const reportOf = new Map<string, { state: string; note: string } | null>();
  for (const b of board?.rows ?? []) reportOf.set(b.threadId, b.report);

  // A commander is a live root thread; its leads are live children.
  const parentOf = (t: ThreadRow): string | null =>
    pendingParents.has(t.id)
      ? (pendingParents.get(t.id) ?? null)
      : (t.parentThreadId ?? null);

  const byParent = new Map<string, ThreadRow[]>();
  for (const t of agentThreads) {
    const parent = parentOf(t);
    if (parent === null) continue;
    const list = byParent.get(parent) ?? [];
    list.push(t);
    byParent.set(parent, list);
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
        const sorties = agentsUnder(t.id, seen);
        return {
          threadId: t.id,
          name: agentName(handleOf.get(t.id) ?? titleOf(t)),
          status: report?.note ?? null,
          working: report?.state === "working",
          rank: rankOf.get(t.id) ?? null,
          liveness: livenessOf.get(t.id) ?? null,
          sorties,
          attention:
            (asksOf.get(t.id) ?? 0) +
            sorties.reduce((total, sortie) => total + sortie.attention, 0),
        };
      });

  // parentOf, not the raw pointer: it is the ONE answer to "whose child is
  // this", and the optimistic reparent already moved the row everywhere else.
  // Reading the server's stale pointer here rendered a dragged root twice —
  // once as its new parent's child, once as a loose chat that had not moved —
  // and made a promotion to root vanish from both bands until the server
  // caught up.
  const roots = agentThreads.filter(
    (t) => parentOf(t) === null && live.has(t.id),
  );

  // Crewed or not, decided by ABSENCE: a root with agents under it is a crew,
  // and so is one carrying a crew handle — chartered but not yet staffed. Both
  // tests read data already in hand, so a root is never parked in limbo waiting
  // on the fleet call; a chartered-but-empty crew simply moves up out of Chats
  // when the handle arrives, the same way ranks settle.
  const isCrewed = (t: ThreadRow) =>
    (byParent.get(t.id) ?? []).some((child) => live.has(child.id)) ||
    handleOf.has(t.id);

  // The standby a failed charter left behind — identified by what this client
  // RECORDED creating, never by what the thread is called. A title is a
  // sentence anyone may write, and classifying "New crew" as a broken setup
  // turned the operator's own chat into a repair prompt.
  //
  // The record only ever narrows: the thread must still be a root, still carry
  // no handle, and still sit on the project it was recorded for. A record that
  // has gone stale stops matching rather than asserting anything.
  const recorded = recordedStandbyRoots();
  // A HANDLE IS NOT COMPLETION. charter writes the handle before the brief, so
  // a root whose charter died in between wears a handle and has no brief — and
  // dropping it from pending here is what took the only Retry off the screen.
  // The record is removed when a charter SUCCEEDS, and until then this stays
  // pending however crewed it looks.
  const isPendingRoot = (t: ThreadRow) =>
    recorded.get(t.id) === (t.projectId ?? PERSONAL_PROJECT_ID);

  const pendingRoots: PendingRoot[] = roots
    .filter(isPendingRoot)
    .map((t) => ({
      threadId: t.id,
      name: titleOf(t),
      // One spelling, so a personal standby is findable by the same id the
      // rest of the app groups it under.
      projectId: t.projectId ?? PERSONAL_PROJECT_ID,
    }));

  const chats: LooseChat[] = roots
    .filter((t) => !isCrewed(t) && !isPendingRoot(t))
    .map((t) => ({
      threadId: t.id,
      name: titleOf(t),
      projectId: t.projectId ?? "",
      liveness: livenessOf.get(t.id) ?? null,
    }));

  const crews = roots
    .filter((t) => isCrewed(t) && !isPendingRoot(t))
    .map((commander) => {
      const leads: CrewLead[] = agentsUnder(commander.id);
      const working = leads.filter((l) => l.working).length;
      return {
        commanderThreadId: commander.id,
        name: titleOf(commander),
        projectId: commander.projectId ?? "",
        liveness: livenessOf.get(commander.id) ?? null,
        leads,
        attention:
          (asksOf.get(commander.id) ?? 0) +
          leads.reduce((total, lead) => total + lead.attention, 0),
        // An agent is an agent. Depth is the only hierarchy there is, and it is
        // shown by where a row sits — so the words here count agents rather than
        // naming a rank the structure no longer has.
        status:
          leads.length === 0
            ? "nothing under it yet"
            : working > 0
              ? `${working} of ${leads.length} working`
              : `${leads.length} agent${leads.length === 1 ? "" : "s"} standing by`,
      };
    });

  return { crews, chats, pendingRoots };
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
  /** Root threads nobody has crewed. Rendered as Chats, below the projects. */
  chats: LooseChat[];
  /** Roots created for a crew whose charter has not gone through yet. */
  pendingRoots: PendingRoot[];
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
  chats: [],
  pendingRoots: [],
  loaded: false,
  failed: false,
  timedOut: false,
};
const subscribers = new Set<() => void>();
let started = false;
let disposeSources: (() => void) | null = null;

interface CrewsSnapshot {
  crews: Crew[];
  chats: LooseChat[];
  pendingRoots: PendingRoot[];
  loaded: boolean;
  failed: boolean;
  /** Set when the last attempt ran out of patience rather than being refused. */
  timedOut: boolean;
}

function publish(next: CrewsSnapshot): void {
  state = next;
  for (const notify of subscribers) notify();
}

/**
 * One fleet read at a time, and one more queued behind it at most.
 *
 * The sidebar reloads on every thread-changed message and every crew signal,
 * which was free when the fleet call was cheap. Carrying liveness made that
 * call cost seconds, so a busy fleet had slow reads piling on top of each
 * other — each one redoing work the one before it had not finished.
 *
 * A signal that arrives mid-read does not start a second read; it asks the
 * running one to go round again when it lands. Nothing is missed, because the
 * follow-up read sees whatever changed while the first was in flight, and the
 * worst case is bounded at two reads rather than one per message.
 */
let loadInFlight: Promise<void> | null = null;
let queuedTimeoutMs: number | null = null;

function requestLoad(timeoutMs: number = READ_TIMEOUT_MS): void {
  if (loadInFlight) {
    // The follow-up keeps the most generous budget asked for while it waited.
    // A manual retry queued behind a routine refresh must not be demoted to the
    // routine deadline — the person pressing it has already seen this fail.
    queuedTimeoutMs = Math.max(queuedTimeoutMs ?? 0, timeoutMs);
    return;
  }
  loadInFlight = loadOnce(timeoutMs).finally(() => {
    loadInFlight = null;
    if (queuedTimeoutMs !== null) {
      const next = queuedTimeoutMs;
      queuedTimeoutMs = null;
      requestLoad(next);
    }
  });
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
    ...assembleFleet(threads, null, null, null, null),
    loaded: true,
    failed: false,
    timedOut: false,
  });

  const [fleet, board, attention, artifacts] = await Promise.all([
    crewRpc<{ rows: FleetRow[] }>(
      "crew_fleet",
      Math.max(timeoutMs, FLEET_READ_TIMEOUT_MS),
    ),
    crewRpc<{ rows: BoardRow[] }>("crew_board", timeoutMs),
    crewRpc<{ open?: AttentionRow[] }>("crew_attention", timeoutMs),
    crewRpc<{ artifacts?: AttentionRow[] }>(
      "crew_artifacts_pending",
      timeoutMs,
    ),
  ]);
  publish({
    ...assembleFleet(threads, fleet, board, attention, artifacts),
    loaded: true,
    failed: false,
    timedOut: false,
  });
}

function startSources(): void {
  if (started) return;
  started = true;
  requestLoad();
  const offSignal = wsManager.onPluginSignal((s) => {
    if (s.pluginId === "crew") requestLoad();
  });
  const offChanged = wsManager.onChanged((m) => {
    if (m.entity === "thread") requestLoad();
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

/** Why a move was refused, in the server's words rather than a guess. */
export type ReparentRefusal =
  | "cycle"
  | "self"
  | "unknown-agent"
  | "not-permitted"
  /** A domain-holding agent's custody is protected from the drag. */
  | "domain-agent";

export interface ReparentOutcome {
  ok: boolean;
  reason?: ReparentRefusal;
  /** Set when the call itself failed rather than being refused. */
  failed?: boolean;
}

const REFUSAL_TEXT: Record<ReparentRefusal, string> = {
  "domain-agent": "that agent holds a domain, so its custody cannot be moved",
  cycle: "that would put an agent inside its own branch",
  self: "an agent cannot report to itself",
  "unknown-agent": "that agent is no longer there",
  "not-permitted": "that move isn't allowed",
};

/** What to tell the operator, in a sentence rather than a code. */
export function reparentRefusalText(outcome: ReparentOutcome): string {
  if (outcome.ok) return "";
  if (outcome.reason) return REFUSAL_TEXT[outcome.reason];
  return "couldn't move it";
}

/**
 * Move an agent under another, or to the root when `newParentId` is null.
 *
 * The row moves first and the server is asked second, because a drag that
 * waits does not feel like a drag. Both endings clear the optimistic move: on
 * success the refetch carries the same shape, and on refusal the row springs
 * back to where the server still says it belongs.
 *
 * A REFUSAL is not a FAILURE. The server answers "that would make a cycle" as
 * a result, and the difference matters on screen: one is a sentence about the
 * fleet, the other is an apology about the software.
 */
export async function reparentAgent(
  threadId: string,
  newParentId: string | null,
): Promise<ReparentOutcome> {
  if (threadId === newParentId) return { ok: false, reason: "self" };
  pendingParents.set(threadId, newParentId);
  requestLoad();
  try {
    const outcome = await readJson<{
      ok?: boolean;
      reason?: ReparentRefusal;
      result?: { ok?: boolean; reason?: ReparentRefusal };
    }>(
      "/api/v1/plugins/crew/rpc/crew_reparent",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, newParentId }),
      },
      READ_TIMEOUT_MS,
    );
    if (!outcome.ok) {
      pendingParents.delete(threadId);
      requestLoad();
      return { ok: false, failed: true };
    }
    // The plugin route wraps its payload; the refusal may arrive at either
    // level, so read the inner one when it is there.
    const result = outcome.value.result ?? outcome.value;
    if (result.ok === false) {
      pendingParents.delete(threadId);
      requestLoad();
      return { ok: false, ...(result.reason ? { reason: result.reason } : {}) };
    }
    // The server's own signal brings the confirmed shape; drop the guess so the
    // two can never disagree silently.
    pendingParents.delete(threadId);
    requestLoad();
    return { ok: true };
  } catch {
    pendingParents.delete(threadId);
    requestLoad();
    return { ok: false, failed: true };
  }
}

export function reloadCrews(): void {
  requestLoad(RETRY_TIMEOUT_MS);
}

export function useCrews(): CrewsState {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  return { ...snapshot, reload: reloadCrews };
}
