import { useCallback, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { AGENT_PROVIDER } from "@/lib/agentProvider";
import { getThreadRoutePath } from "@/lib/route-paths";
import { ROOT_THREAD_TITLE } from "./useCrews";
import {
  forgetStandbyRoot,
  purgeStandbyRoots,
  recordedStandbyRoots,
  rememberStandbyRoot,
} from "./standbyRoots";
import { sdk } from "@/lib/sdk";

interface ProjectRow {
  id: string;
}

function parseProjectRow(row: unknown): ProjectRow | null {
  if (typeof row !== "object" || row === null) return null;
  const id = (row as Record<string, unknown>).id;
  return typeof id === "string" && id !== "" ? { id } : null;
}

function parseHostId(row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  const id = (row as Record<string, unknown>).id;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * The brief, fetched when someone actually presses the button.
 *
 * It is a couple of kilobytes of prose that the sidebar carried in its boot
 * chunk for the whole session to spend on one click. Nothing renders it, so
 * there is nothing to hold up: it is awaited inside the flow that needs it.
 */
async function loadRootBootstrap(): Promise<string> {
  return (await import("./rootAgentBootstrap.md?raw")).default;
}

/** The root's first input, before it is anything. It is not the brief: the
 *  brief goes out only once the charter has made this a crew root. */
const STANDBY_INPUT =
  "Stand by. You are being chartered as this project's root agent and will " +
  "receive your brief in a moment. Do not start any work yet.";

/**
 * Nothing here may wait forever.
 *
 * Every call this flow makes is on the path between a press and a crew, and a
 * request that never settles leaves the button spinning with no way back —
 * worse than a refusal, which at least says something.
 */
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** A promise that loses to the clock rather than hanging the press. */
async function withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} did not answer in time.`)),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A request AND the reading of its body, both bounded.
 *
 * Aborting the fetch does not bound `res.json()`: a response whose body never
 * finishes arriving leaves the read pending forever, which is the same stuck
 * button by another route.
 */
async function readJsonFrom(
  url: string,
  init?: RequestInit,
): Promise<unknown | null> {
  try {
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) return null;
    return await withDeadline(res.json(), "The rig");
  } catch {
    return null;
  }
}

async function readJson<T>(url: string): Promise<T | null> {
  return (await readJsonFrom(url)) as T | null;
}

interface ThreadRow {
  id: string;
  projectId?: string;
  title?: string | null;
  parentThreadId?: string | null;
}

/** Every row is checked. A list with one unreadable row is an unreadable list:
 *  the row that failed to parse could be the root being asked about. */
function parseThreadRow(row: unknown): ThreadRow | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  if (r.projectId !== undefined && typeof r.projectId !== "string") return null;
  if (
    r.parentThreadId !== undefined &&
    r.parentThreadId !== null &&
    typeof r.parentThreadId !== "string"
  ) {
    return null;
  }
  if (r.title !== undefined && r.title !== null && typeof r.title !== "string") {
    return null;
  }
  return {
    id: r.id,
    ...(typeof r.projectId === "string" ? { projectId: r.projectId } : {}),
    ...(typeof r.title === "string" ? { title: r.title } : {}),
    parentThreadId:
      typeof r.parentThreadId === "string" ? r.parentThreadId : null,
  };
}

/**
 * The live thread list, or null when it could not be read.
 *
 * NOT an empty array on failure, and not a partially parsed one either. Every
 * caller uses this list to decide whether a root already exists, and a list
 * that answers "none" because it could not be read is the answer that creates
 * the duplicate.
 */
async function readThreadRows(): Promise<ThreadRow[] | null> {
  const body = await readJson<unknown>("/api/v1/threads?archived=false");
  if (body === null) return null;
  const raw = Array.isArray(body)
    ? body
    : ((body as { threads?: unknown[]; data?: unknown[] }).threads ??
      (body as { data?: unknown[] }).data);
  if (!Array.isArray(raw)) return null;
  const parsed = raw.map(parseThreadRow);
  return parsed.some((r) => r === null) ? null : (parsed as ThreadRow[]);
}

/** One spelling of the projectless project, everywhere. */
function projectOf(thread: { projectId?: string }): string {
  return thread.projectId ?? PERSONAL_PROJECT_ID;
}

const UNREADABLE_FLEET =
  "Could not read this rig's threads, so a crew cannot be started safely right now.";
const UNREADABLE_CREW =
  "Could not read the crew ledger, so a crew cannot be started safely right now.";
const UNREADABLE_PROJECTS =
  "Could not read this rig's projects, so a crew cannot be started safely right now.";

/** The task id a project's root is chartered under. Deterministic on purpose:
 *  a retry after a failed charter charters the SAME work, not a second one. */
function rootTaskId(projectId: string): string {
  return `root-${projectId}`;
}

interface CharterOutcome {
  ok: boolean;
  message: string | null;
}

/** A fleet row this code is willing to reason about. Anything else is a fleet
 *  it cannot read, which is not the same as a fleet with nothing in it. */
interface FleetRow {
  threadId: string;
  handle: string | null;
  parentThreadId: string | null;
}

function parseFleetRow(row: unknown): FleetRow | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.threadId !== "string" || r.threadId === "") return null;
  // PRESENT and nullable, not merely "not the wrong type". A row missing
  // `handle` is a row from something that is not this contract, and reading a
  // missing key as null is how an ungoverned thread passes for a crew root.
  if (!("handle" in r) || (r.handle !== null && typeof r.handle !== "string")) {
    return null;
  }
  if (
    !("parentThreadId" in r) ||
    (r.parentThreadId !== null && typeof r.parentThreadId !== "string")
  ) {
    return null;
  }
  return {
    threadId: r.threadId,
    handle: r.handle as string | null,
    parentThreadId: r.parentThreadId as string | null,
  };
}

/**
 * What the fleet said about this project's crew root.
 *
 * Three answers, never two. "There is no root" and "I could not find out" lead
 * to opposite decisions — one may create, the other must not — and collapsing
 * them into null is what turns a bad minute on the rig into a duplicate crew.
 */
type FleetAnswer =
  | { status: "root"; thread: ThreadRow }
  | { status: "none" }
  | { status: "unavailable" };

/** Text from a plugin envelope, whatever shape the failure arrived in. */
function messageOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  for (const key of ["error", "message"]) {
    const found = v[key];
    if (typeof found === "string" && found.trim() !== "") return found;
    // A structured error object rather than a string: read its message, and
    // never render "[object Object]" at the operator.
    if (typeof found === "object" && found !== null) {
      const nested = (found as Record<string, unknown>).message;
      if (typeof nested === "string" && nested.trim() !== "") return nested;
    }
  }
  return null;
}

/**
 * The thread holding this project's crew, per the fleet.
 *
 * The fleet row records no project, so the project boundary is read where it
 * is actually kept — on the thread.
 */
async function governedRootFor(
  projectId: string,
  threads: readonly ThreadRow[],
): Promise<FleetAnswer> {
  const payload = await readJsonFrom("/api/v1/plugins/crew/rpc/crew_fleet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  if (typeof payload !== "object" || payload === null) {
    return { status: "unavailable" };
  }
  const envelope = payload as Record<string, unknown>;
  // BOTH levels must say ok, explicitly. The port wraps the verb's own
  // discriminated union, so a transport that succeeded carrying a verb that
  // failed is still a fleet this code cannot read.
  if (envelope.ok !== true) return { status: "unavailable" };
  const inner = envelope.result;
  if (typeof inner !== "object" || inner === null) {
    return { status: "unavailable" };
  }
  const result = inner as Record<string, unknown>;
  if (result.ok !== true) return { status: "unavailable" };
  const rawRows = result.rows;
  if (!Array.isArray(rawRows)) return { status: "unavailable" };
  // The plugin reports the rows IT could not read in `unreadable`. One entry
  // there and the fleet is partial — and the row it dropped could be the very
  // root being asked about, so a partial fleet is an unreadable one.
  if (!Array.isArray(result.unreadable)) return { status: "unavailable" };
  if (result.unreadable.length > 0) return { status: "unavailable" };
  const parsed = rawRows.map(parseFleetRow);
  if (parsed.some((r) => r === null)) return { status: "unavailable" };

  const governed = new Set(
    (parsed as FleetRow[])
      .filter((r) => r.handle !== null && r.parentThreadId === null)
      .map((r) => r.threadId),
  );
  const thread = threads.find(
    (t) => governed.has(t.id) && projectOf(t) === projectId,
  );
  return thread ? { status: "root", thread } : { status: "none" };
}

/**
 * Turn a standby root into a governed crew root.
 *
 * A refusal is a refusal. It used to be downgraded to success when the fleet
 * showed this thread already carrying a handle, and that is exactly wrong:
 * charter writes the handle BEFORE the brief, so "handle present, charter
 * refused" is the signature of a root that was half made. Accepting it briefed
 * a root whose brief had never been stored.
 */
async function charterRoot(
  threadId: string,
  briefText: string,
  taskId: string,
): Promise<CharterOutcome> {
  const body = await readJsonFrom("/api/v1/plugins/crew/rpc/crew_charter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, briefText, taskId }),
  });
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "The crew plugin did not answer." };
  }
  const envelope = body as Record<string, unknown>;
  const inner =
    typeof envelope.result === "object" && envelope.result !== null
      ? (envelope.result as Record<string, unknown>)
      : {};
  // Both levels, because a fault can be reported at either: the port's own
  // envelope carries transport failures, the verb's result carries refusals.
  const message = messageOf(inner) ?? messageOf(envelope);
  if (envelope.ok === true && isCharteredResult(inner, threadId)) {
    return { ok: true, message: null };
  }
  return {
    ok: false,
    message: message ?? "The crew could not be chartered.",
  };
}

/**
 * The success arm of crew_charter, in full.
 *
 * A charter is the one call whose "yes" this flow acts on, and it acts by
 * briefing an agent and handing the operator a crew. So the whole shape is
 * checked — including that it is talking about the thread we asked about.
 * A truncated body carrying `ok: true` is not a chartered crew.
 */
function isCharteredResult(
  result: Record<string, unknown>,
  threadId: string,
): boolean {
  if (result.ok !== true) return false;
  if (result.threadId !== threadId) return false;
  if (typeof result.rank !== "string" || result.rank === "") return false;
  if (typeof result.derivedRank !== "string" || result.derivedRank === "") {
    return false;
  }
  if (typeof result.depth !== "number") return false;
  if (result.handle !== null && typeof result.handle !== "string") return false;
  if (result.domain !== null && typeof result.domain !== "string") return false;
  // Nullable, but PRESENT: these say what the root will actually run on, and
  // a body that omits them is not this contract's success arm.
  if (
    !("providerId" in result) ||
    (result.providerId !== null && typeof result.providerId !== "string")
  ) {
    return false;
  }
  if (
    !("model" in result) ||
    (result.model !== null && typeof result.model !== "string")
  ) {
    return false;
  }
  // Where the brief was durably written. Null is the plugin's own honest
  // answer for a thread with no workspace, so it is a shape check, not a
  // presence check — the verb's ok is what promises the brief is durable.
  if (
    result.briefWrittenTo !== null &&
    typeof result.briefWrittenTo !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(result.leads)) return false;
  // Each lead is a record on the wire. An array of anything else is a shape
  // this code has never seen, and the whole point of checking the success arm
  // is that a body it does not recognise is not a chartered crew.
  return result.leads.every(
    (lead) => typeof lead === "object" && lead !== null && !Array.isArray(lead),
  );
}

/**
 * What a chartered root is told: its brief, then what the Captain actually
 * asked for. One send, so the two cannot arrive as separate turns and have the
 * root answer the brief before it has read the request.
 */
async function sendRootOpening({
  threadId,
  bootstrap,
  openingRequest,
}: {
  threadId: string;
  /** Null once the root is already carrying its brief from an earlier charter. */
  bootstrap: string | null;
  openingRequest?: string;
}): Promise<void> {
  const request = openingRequest?.trim();
  const input = [
    ...(bootstrap !== null
      ? [{ type: "text" as const, text: bootstrap, mentions: [] }]
      : []),
    ...(request
      ? [
          {
            type: "text" as const,
            text: `The Captain's opening request:\n\n${request}`,
            mentions: [],
          },
        ]
      : []),
  ];
  if (input.length === 0) return;
  // The SDK takes no deadline of its own, so the bound is applied here: this
  // is the last leg before the operator is handed a crew, and a send that
  // never settles leaves the button spinning with nothing said.
  await Promise.race([
    sdk.threads.send({ threadId, input, mode: "auto" }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("The opening message could not be delivered.")),
        REQUEST_TIMEOUT_MS,
      ),
    ),
  ]);
}

/** The id of a thread that WAS created, when the body still yields one. */
function recoverableThreadId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const id = (body as Record<string, unknown>).id;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Undo a creation this flow can no longer use, and say what happened.
 *
 * The one thing never to say here is "no crew was made". A thread exists
 * either way; the only question is whether its id came back well enough to
 * archive it. An orphan nobody can name is the worst outcome, so an
 * unrecoverable id is stated as exactly that.
 */
async function cleanUpStranded(
  threadId: string | null,
  reason: string,
): Promise<string> {
  if (threadId === null) {
    return (
      `A thread was created, ${reason}, and the rig did not name it — so it ` +
      `could not be cleaned up. Look for an unnamed root on this project and ` +
      `archive it.`
    );
  }
  try {
    await withDeadline(
      sdk.threads.archive({ threadId }),
      "Archiving the unusable thread",
    );
  } catch (e) {
    return (
      `A thread was created (${threadId}), ${reason}, and archiving it ` +
      `failed${e instanceof Error ? `: ${e.message}` : ""}. Archive it by ` +
      `hand so it does not sit on the rail.`
    );
  }
  return `A thread was created, ${reason}, so it was archived. Try again.`;
}

/**
 * What to do when our charter was refused and someone else may have won.
 *
 * Only ever called with the standby THIS invocation created. It re-reads the
 * fleet fail-closed: unless a DIFFERENT governed root is now holding this
 * project, nothing is archived and the original refusal stands. A losing
 * standby is archived rather than left on the rail, and an archive that fails
 * is said out loud — an orphan nobody can see is worse than one that is named.
 */
async function recoverLostRace({
  ourThreadId,
  projectId,
  refusal,
}: {
  ourThreadId: string;
  projectId: string;
  refusal: string | null;
}): Promise<
  { outcome: "winner"; thread: ThreadRow } | { outcome: "error"; message: string }
> {
  const threads = await readThreadRows();
  if (threads === null) {
    return { outcome: "error", message: refusal ?? UNREADABLE_FLEET };
  }
  const answer = await governedRootFor(projectId, threads);
  // Fail closed: an unreadable fleet is never grounds to archive anything.
  if (answer.status !== "root" || answer.thread.id === ourThreadId) {
    return { outcome: "error", message: refusal ?? UNREADABLE_CREW };
  }
  try {
    await withDeadline(
      sdk.threads.archive({ threadId: ourThreadId }),
      "Archiving the losing thread",
    );
  } catch (e) {
    return {
      outcome: "error",
      message:
        `Another crew won this project, but the thread this attempt created ` +
        `(${ourThreadId}) could not be archived` +
        `${e instanceof Error ? `: ${e.message}` : ""}. ` +
        `Archive it by hand so it does not sit on the rail.`,
    };
  }
  forgetStandbyRoot(ourThreadId);
  return { outcome: "winner", thread: answer.thread };
}

/**
 * Clear this client's own standbys out from under a crew that already won.
 *
 * A root recorded on an earlier press — or before a reload, or by the losing
 * half of a cross-process race — is still sitting on the rig. Once a governed
 * crew exists for the project, the card shows that crew and the Retry that
 * would have finished the standby is gone with it, so nothing on screen names
 * the leftover any more.
 *
 * Only ever archives a thread THIS client recorded creating, on THIS project,
 * that is not the winner. Forgets a record only once its thread is actually
 * gone, and refuses to open past a cleanup it could not do: a leftover that is
 * merely invisible is the thing being fixed.
 *
 * Answers null when there is nothing left behind, or the message to show.
 */
async function archiveRecordedLosers(
  projectId: string,
  winnerId: string,
  threads: readonly ThreadRow[],
): Promise<string | null> {
  const recorded = recordedStandbyRoots();
  const live = new Map(threads.map((t) => [t.id, t]));
  for (const [threadId, recordedProject] of recorded) {
    if (recordedProject !== projectId || threadId === winnerId) continue;
    const thread = live.get(threadId);
    if (thread === undefined) {
      // Already gone; the note is all that is left of it.
      forgetStandbyRoot(threadId);
      continue;
    }
    if (thread.parentThreadId) continue;
    try {
      await withDeadline(
        sdk.threads.archive({ threadId }),
        "Archiving a leftover standby",
      );
    } catch (e) {
      return (
        `This project already has a crew, but a thread left over from an ` +
        `earlier attempt (${threadId}) could not be archived` +
        `${e instanceof Error ? `: ${e.message}` : ""}. Archive it by hand — ` +
        `until it is gone nothing on this card will show it.`
      );
    }
    forgetStandbyRoot(threadId);
  }
  return null;
}

/**
 * Open a root the fleet says is already this project's crew.
 *
 * Charters it FIRST, every time and from every path. A handle proves a charter
 * started, never that it finished — the brief is written after it — so this
 * call is what makes an ok answer mean "handle AND durable brief" before an
 * operator is handed the thread as a working crew. Idempotent by contract:
 * a root that is already complete is unchanged.
 *
 * Answers null on success, or the message to show.
 */
async function openGovernedRoot(
  thread: ThreadRow,
  { openingRequest }: { openingRequest?: string },
): Promise<string | null> {
  const projectId = projectOf(thread);
  const repaired = await charterRoot(
    thread.id,
    await loadRootBootstrap(),
    rootTaskId(projectId),
  );
  if (!repaired.ok) return repaired.message ?? "The crew could not be opened.";
  charteredRoots.add(thread.id);
  forgetStandbyRoot(thread.id);
  await sendRootOpening({
    threadId: thread.id,
    bootstrap: null,
    openingRequest,
  });
  return null;
}

/**
 * Pressing NEW CREW stands up the project's ROOT AGENT.
 *
 * The order is the contract. The root is created project-bound and
 * worktree-less with a STANDBY first input only, then chartered, and only once
 * the charter succeeds does it receive the bootstrap brief and the Captain's
 * opening request. A root that could not be chartered is never given the brief
 * and never navigated into: it would be a loose thread wearing a crew's name,
 * with none of the handle, brief, ceiling or lifecycle behind it.
 *
 * A failed charter leaves the standby root in place on purpose. The next press
 * finds it by title and retries the charter rather than leaving a second husk
 * on the rail.
 *
 * The brief lives in its own file (rootAgentBootstrap.md) because it IS the
 * product surface — it should be iterated like any other reviewable text, not
 * buried as a string literal in a component.
 */
/**
 * Projects with a creation in flight, shared by every instance of this hook.
 *
 * `creating` is per-component state, and the rail button and each project
 * card hold their own. Two of them pressed together each saw an idle flag,
 * each read a thread list with no root on it, and each created one — the
 * duplicate this guard exists to make impossible.
 */
/** Roots this session has seen charter successfully. Authoritative in a way a
 *  handle is not: charter writes the handle before the brief. */
const charteredRoots = new Set<string>();

const creatingProjects = new Set<string>();
const creatingListeners = new Set<() => void>();

function markCreating(projectId: string, active: boolean): void {
  if (active) creatingProjects.add(projectId);
  else creatingProjects.delete(projectId);
  creatingSnapshot = new Set(creatingProjects);
  for (const listener of creatingListeners) listener();
}

function subscribeCreating(listener: () => void): () => void {
  creatingListeners.add(listener);
  return () => {
    creatingListeners.delete(listener);
  };
}

// A snapshot that only changes identity when the SET does, so the store read
// below is stable between marks.
let creatingSnapshot: ReadonlySet<string> = new Set();
const readCreating = () => creatingSnapshot;
const noneCreating: ReadonlySet<string> = new Set();
const readNoneCreating = () => noneCreating;

export function useCreateCrew(): {
  /** Name the project the crew is FOR; omit only when it has no code yet. */
  createCrew: (forProjectId?: string, openingRequest?: string) => void;
  /** Whether ANY creation is running — for a surface with no project yet. */
  creating: boolean;
  /** Whether THIS project is the one standing up a crew. */
  creatingFor: (projectId: string) => boolean;
  error: string | null;
} {
  const navigate = useNavigate();
  // Read from the shared set, so every button that can start a crew shows the
  // one in flight — including the ones that did not start it.
  const creatingIds = useSyncExternalStore(
    subscribeCreating,
    readCreating,
    readNoneCreating,
  );
  const creating = creatingIds.size > 0;
  // Per project, because a crew standing up on one project is no reason to
  // take another project's only affordance away.
  const creatingFor = useCallback(
    (projectId: string) => creatingIds.has(projectId),
    [creatingIds],
  );
  const [error, setError] = useState<string | null>(null);

  const createCrew = useCallback(
    (forProjectId?: string, openingRequest?: string) => {
      // Scoped to the project asked for, because a root is born on its
      // project and can never move: resuming Personal's unnamed root when
      // the press came from a repo-backed project hands back an agent that
      // can talk and can never dispatch for the project clicked.
      const wantedProjectId = forProjectId ?? PERSONAL_PROJECT_ID;
      if (creatingProjects.has(wantedProjectId)) return;
      markCreating(wantedProjectId, true);
      setError(null);
      void (async () => {
        try {
          // IDEMPOTENCY: a second press must resume the root already standing
          // rather than leave another husk on the rail. Three unnamed roots
          // with nothing under them is what repeated presses produced before.
          const threads = await readThreadRows();
          if (threads === null) {
            setError(UNREADABLE_FLEET);
            return;
          }

          // A project holds ONE crew. Its root may have been named long ago,
          // in which case the title check below cannot see it — and creating a
          // standby anyway leaves a loose thread behind for a charter that was
          // always going to be refused. Ask the fleet first and open what is
          // already there.
          const owned = await governedRootFor(wantedProjectId, threads);
          if (owned.status === "unavailable") {
            setError(UNREADABLE_CREW);
            return;
          }
          if (owned.status === "root") {
            // Before this project's crew takes the card back, anything this
            // client left half-made on it has to go — the winning crew hides
            // the Retry that was the only way to see it.
            const leftover = await archiveRecordedLosers(
              wantedProjectId,
              owned.thread.id,
              threads,
            );
            if (leftover !== null) {
              setError(leftover);
              return;
            }
            const opened = await openGovernedRoot(owned.thread, {
              openingRequest,
            });
            if (opened !== null) {
              setError(opened);
              return;
            }
            navigate(
              getThreadRoutePath({
                projectId: projectOf(owned.thread),
                threadId: owned.thread.id,
              }),
            );
            return;
          }

          // Notes the rig no longer agrees with: deleted, reparented, moved
          // to another project, or since chartered. Left alone they answer
          // questions about threads that stopped matching them long ago.
          purgeStandbyRoots(threads, charteredRoots);
          // What THIS client recorded standing up here — not what a thread is
          // called. Resuming on a title picked up the operator's own chat.
          const recorded = recordedStandbyRoots();
          const unfinished = threads.find(
            (t) =>
              !t.parentThreadId &&
              projectOf(t) === wantedProjectId &&
              recorded.get(t.id) === projectOf(t),
          );
          if (unfinished) {
            // A root found this way may be a standby whose charter failed last
            // time, so the charter is retried before anything else. It is
            // idempotent under the same task id, and a thread that is already
            // crew comes back as the success it is.
            const rootProjectId = projectOf(unfinished);
            const chartered = await charterRoot(
              unfinished.id,
              await loadRootBootstrap(),
              rootTaskId(rootProjectId),
            );
            if (!chartered.ok) {
              const recovered = await recoverLostRace({
                ourThreadId: unfinished.id,
                projectId: rootProjectId,
                refusal: chartered.message,
              });
              if (recovered.outcome === "winner") {
                const opened = await openGovernedRoot(recovered.thread, {
                  openingRequest,
                });
                if (opened !== null) {
                  setError(opened);
                  return;
                }
                navigate(
                  getThreadRoutePath({
                    projectId: projectOf(recovered.thread),
                    threadId: recovered.thread.id,
                  }),
                );
                return;
              }
              setError(recovered.message);
              return;
            }
            charteredRoots.add(unfinished.id);
            forgetStandbyRoot(unfinished.id);
            // The brief goes out on BOTH paths here. A fleet row proves a
            // handle was written; it says nothing about whether the brief that
            // should have gone with it ever landed. Between re-stating standing
            // orders to a root that has them and leaving a half-chartered root
            // that never learned what it is, only one is recoverable.
            await sendRootOpening({
              threadId: unfinished.id,
              bootstrap: await loadRootBootstrap(),
              openingRequest,
            });
            // Scoped, like every thread link: the projectless route resolves to
            // the Personal project, which happens to be right for a root with
            // no code yet and would be silently wrong the day it is not.
            navigate(
              getThreadRoutePath({
                projectId: rootProjectId,
                threadId: unfinished.id,
              }),
            );
            return;
          }

          // A commander is BORN on the project its crew is for. It does not need a
          // worktree — only its leads do — but it does need the project, because
          // a thread cannot parent a child across a project line and a thread's
          // project is immutable after creation. Put the commander on Personal
          // "for now" and it can talk but can never dispatch real work.
          //
          // So: the caller names the project. Only when nothing is named does
          // Personal apply, which is right for a crew that has no code yet and
          // is the one case where "talks only" is the whole story.
          const projects = await readJson<unknown>(
            "/api/v1/projects?includePersonal=true",
          );
          if (projects === null) {
            setError(UNREADABLE_PROJECTS);
            return;
          }
          const rawProjects = Array.isArray(projects)
            ? projects
            : (projects as { projects?: unknown[] }).projects;
          if (!Array.isArray(rawProjects)) {
            setError(UNREADABLE_PROJECTS);
            return;
          }
          const parsedProjects = rawProjects.map(parseProjectRow);
          if (parsedProjects.some((p) => p === null)) {
            setError(UNREADABLE_PROJECTS);
            return;
          }
          const list = parsedProjects as ProjectRow[];
          // A NAMED project is the whole instruction. If it is not there after
          // this refresh — deleted, renamed away, never existed — the answer is
          // to say so. Falling back to Personal built the crew somewhere the
          // operator did not ask for, on a project it can never leave.
          if (forProjectId !== undefined) {
            if (!list.some((p) => p.id === forProjectId)) {
              setError(
                "That project is no longer on this rig, so its crew cannot be started.",
              );
              return;
            }
          }
          // Personal is the canonical id or nothing. Matching on a `kind`
          // field instead put the crew on whatever project happened to call
          // itself personal, and `list[0]` put it on whatever came first.
          const projectId =
            forProjectId ?? list.find((p) => p.id === PERSONAL_PROJECT_ID)?.id;
          if (!projectId) {
            setError(
              "No project is registered on this rig yet, so a crew cannot be started.",
            );
            return;
          }
          const isPersonalProject = projectId === PERSONAL_PROJECT_ID;

          const hosts = await readJson<unknown>("/api/v1/hosts");
          const rawHosts = Array.isArray(hosts)
            ? hosts
            : (hosts as { hosts?: unknown[] } | null)?.hosts;
          if (!Array.isArray(rawHosts)) {
            setError("No host is connected, so a crew cannot be started yet.");
            return;
          }
          // ALL OR NOTHING, like every other list this flow reads. Skipping a
          // malformed row to the next valid one picks a host out of a list
          // this code has already proved it cannot read.
          const hostIds = rawHosts.map(parseHostId);
          if (hostIds.some((id) => id === null)) {
            setError(
              "Could not read this rig's hosts, so a crew cannot be started safely right now.",
            );
            return;
          }
          const hostId = hostIds[0];
          if (!hostId) {
            setError("No host is connected, so a crew cannot be started yet.");
            return;
          }

          // The create is the one call whose FAILURE is ambiguous. Every other
          // request either happened or did not; this one may have been
          // committed by the server and lost on the way back, leaving a root
          // with no id to clean up by.
          let res: Response;
          try {
            res = await fetchWithTimeout("/api/v1/threads", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                projectId,
                origin: "app",
                title: ROOT_THREAD_TITLE,
                // Provider AND model together, from the one shared path. Pinning
                // only the provider still lets the instance resolve its default
                // MODEL — which may belong to a dead provider, which is how this
                // fault survived being "fixed" once already.
                providerId: AGENT_PROVIDER.providerId,
                model: AGENT_PROVIDER.model,
                // The root ORCHESTRATES — it never edits this project, so it
                // must not provision a worktree. A managed one cost the Captain
                // ~10 MINUTES of pnpm (2318 packages, 3.7GB) before his root
                // could say a word, and dragged the whole machine.
                //
                // On Personal that is guaranteed by construction: a personal
                // workspace has no repo to clone. On a real project an unmanaged
                // workspace with no path is the nearest thing — it provisions
                // nothing, but only because it was asked not to — while still
                // letting the root parent children that DO get worktrees.
                // Measured on the rig: 12 seconds to first word on a repo-backed
                // project, against ten minutes for a managed one.
                environment: {
                  type: "host",
                  hostId,
                  workspace: isPersonalProject
                    ? { type: "personal" }
                    : { type: "unmanaged", path: null },
                },
                // STANDBY ONLY. The brief and the Captain's request are held
                // back until the charter succeeds — a root that turns out to be
                // uncharterable must never have been told to start work. The
                // threads API requires a first entry, so this is the smallest
                // honest one: an instruction to wait.
                input: [{ type: "text", text: STANDBY_INPUT, mentions: [] }],
              }),
            });
          } catch {
            setError(
              "The rig stopped answering while the crew was being created. " +
                "It may have been made anyway, and there is no id to clean it " +
                "up by — check this project for an unnamed root before trying " +
                "again.",
            );
            return;
          }
          if (!res.ok) {
            // Bounded like every other read: a refusal whose body never
            // finishes arriving is the same stuck button by another route.
            const failure = await withDeadline(
              res.json().catch(() => null),
              "The rig",
            ).catch(() => null);
            setError(
              messageOf(failure) ??
                `Could not start the crew (${res.status}).`,
            );
            return;
          }
          const createdBody = await withDeadline(
            res.json().catch(() => null),
            "The rig",
          ).catch(() => null);
          const created = parseThreadRow(createdBody);
          // The crew is about to be chartered onto whatever came back. An id
          // that is missing, or a project that is not the one asked for, is a
          // root somewhere the operator did not choose — and a root cannot
          // move afterwards.
          if (created === null || projectOf(created) !== projectId) {
            // A thread WAS created. Whether its id is recoverable from this
            // body decides whether it can be cleaned up or only named.
            const strandedId = recoverableThreadId(createdBody);
            setError(
              await cleanUpStranded(
                strandedId,
                "but this crew cannot be built on it",
              ),
            );
            return;
          }
          const thread = created;
          const rootProjectId = projectOf(thread);
          // Recorded BEFORE the charter is attempted: if the charter fails, or
          // the tab closes mid-flight, this note is the only thing that can
          // tell this standby apart from an ordinary chat afterwards.
          try {
            rememberStandbyRoot(thread.id, rootProjectId);
          } catch {
            // The thread exists and nothing here can identify it later, so it
            // is cleaned up now rather than left as an unrecognisable root.
            setError(
              await cleanUpStranded(
                thread.id,
                "but this browser could not record it",
              ),
            );
            return;
          }

          const chartered = await charterRoot(
            thread.id,
            await loadRootBootstrap(),
            rootTaskId(rootProjectId),
          );
          if (!chartered.ok) {
            const recovered = await recoverLostRace({
              ourThreadId: thread.id,
              projectId: rootProjectId,
              refusal: chartered.message,
            });
            if (recovered.outcome === "winner") {
              const opened = await openGovernedRoot(recovered.thread, {
                openingRequest,
              });
              if (opened !== null) {
                setError(opened);
                return;
              }
              navigate(
                getThreadRoutePath({
                  projectId: projectOf(recovered.thread),
                  threadId: recovered.thread.id,
                }),
              );
              return;
            }
            setError(recovered.message);
            return;
          }
          charteredRoots.add(thread.id);
          forgetStandbyRoot(thread.id);
          await sendRootOpening({
            threadId: thread.id,
            bootstrap: await loadRootBootstrap(),
            openingRequest,
          });
          navigate(
            getThreadRoutePath({
              projectId: rootProjectId,
              threadId: thread.id,
            }),
          );
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Could not start the crew.",
          );
        } finally {
          markCreating(wantedProjectId, false);
        }
      })();
    },
    [navigate],
  );

  return { createCrew, creating, creatingFor, error };
}
