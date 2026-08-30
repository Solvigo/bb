import { useCallback, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { AGENT_PROVIDER } from "@/lib/agentProvider";
import { getThreadRoutePath } from "@/lib/route-paths";
import { ROOT_THREAD_TITLE, UNNAMED_ROOT_TITLES } from "./useCrews";
import { sdk } from "@/lib/sdk";

interface ProjectRow {
  id: string;
  kind?: string;
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

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface ThreadRow {
  id: string;
  projectId?: string;
  title?: string | null;
  parentThreadId?: string | null;
}

/**
 * The live thread list, or null when it could not be read.
 *
 * NOT an empty array on failure. Every caller uses this list to decide whether
 * a root already exists, and an unread list that answers "none" is the answer
 * that creates the duplicate — silently, and exactly when the rig is already
 * having a bad minute.
 */
async function readThreadRows(): Promise<ThreadRow[] | null> {
  const body = await readJson<unknown>("/api/v1/threads?archived=false");
  if (body === null) return null;
  if (Array.isArray(body)) return body as ThreadRow[];
  const wrapped = body as { threads?: unknown[]; data?: unknown[] };
  const rows = wrapped.threads ?? wrapped.data;
  return rows === undefined ? null : (rows as ThreadRow[]);
}

const UNREADABLE_FLEET =
  "Could not read this rig's threads, so a crew cannot be started safely right now.";

/** The task id a project's root is chartered under. Deterministic on purpose:
 *  a retry after a failed charter charters the SAME work, not a second one. */
function rootTaskId(projectId: string): string {
  return `root-${projectId}`;
}

interface CharterOutcome {
  ok: boolean;
  message: string | null;
}

interface FleetRow {
  threadId?: string;
  handle?: string | null;
  parentThreadId?: string | null;
}

interface CharterEnvelope {
  ok?: boolean;
  error?: string;
  message?: string;
  result?: { ok?: boolean; error?: string; message?: string };
}

interface FleetEnvelope {
  result?: { rows?: FleetRow[] };
  rows?: FleetRow[];
}

/**
 * Whether THIS thread is already a governed crew root on THIS project.
 *
 * A retry has to tell "already chartered, carry on" apart from "something else
 * holds this project's crew slot", and the two arrive as refusals worded by
 * the plugin. Reading the wording is how a sentence like "this project already
 * has a crew" gets mistaken for success, so the answer is read from the fleet
 * instead: the exact thread id, carrying a handle, parented by nothing. The
 * fleet row records no project, so the project boundary is read where it is
 * actually kept — on the thread.
 */
async function readGovernedRoots(): Promise<FleetRow[] | null> {
  try {
    const res = await fetchWithTimeout(
      "/api/v1/plugins/crew/rpc/crew_fleet",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      },
    );
    if (!res.ok) return null;
    const fleet = (await res.json()) as FleetEnvelope;
    const rows = fleet?.result?.rows ?? fleet?.rows;
    if (rows === undefined) return null;
    return rows.filter((r) => Boolean(r.handle) && !r.parentThreadId);
  } catch {
    return null;
  }
}

/**
 * The thread already holding this project's crew, if one is.
 *
 * The fleet row records no project, so the project boundary is read where it
 * is actually kept — on the thread. A fleet that cannot be read answers null,
 * which is "unknown", never "there is none".
 */
async function governedRootFor(
  projectId: string,
  threads: readonly ThreadRow[],
): Promise<ThreadRow | null> {
  const governed = await readGovernedRoots();
  if (governed === null) return null;
  const ids = new Set(governed.map((r) => r.threadId));
  return (
    threads.find(
      (t) =>
        ids.has(t.id) && (t.projectId ?? PERSONAL_PROJECT_ID) === projectId,
    ) ?? null
  );
}

async function isGovernedRootFor(
  threadId: string,
  projectId: string,
): Promise<boolean> {
  const threads = await readThreadRows();
  if (threads === null) return false;
  const root = await governedRootFor(projectId, threads);
  return root !== null && root.id === threadId;
}

/**
 * Turn a standby root into a governed crew root.
 *
 * The plugin refuses rather than throwing for anything the operator can act
 * on, and wraps its payload the way every other crew verb does, so read the
 * inner result when it is there. A refusal is only ever downgraded to success
 * by the fleet confirming this exact thread is already the project's crew
 * root — never by what the refusal says.
 */
async function charterRoot(
  threadId: string,
  projectId: string,
  briefText: string,
  taskId: string,
): Promise<CharterOutcome> {
  let res: Response;
  try {
    res = await fetchWithTimeout("/api/v1/plugins/crew/rpc/crew_charter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, briefText, taskId }),
    });
  } catch {
    return {
      ok: false,
      message: "The crew plugin did not answer.",
    };
  }
  const body = (await res.json().catch(() => null)) as CharterEnvelope | null;
  // Both levels, because a fault can be reported at either: the port's own
  // envelope carries transport failures, the verb's result carries refusals.
  const message =
    body?.result?.error ??
    body?.result?.message ??
    body?.error ??
    body?.message ??
    null;
  // SUCCESS MUST BE STATED. A 200 whose body is empty, truncated, or shaped
  // some way this code has never seen is not a chartered crew — and treating
  // it as one is how an unchartered root gets briefed and opened as if it
  // were governed.
  const chartered =
    res.ok && (body?.result?.ok === true || (body?.ok === true && !body.result));
  if (chartered) return { ok: true, message: null };

  // The one thing that turns a refusal into a success: the fleet already lists
  // this exact thread as this project's governed root, so the charter it is
  // refusing is the charter it already has.
  if (await isGovernedRootFor(threadId, projectId)) {
    return { ok: true, message: null };
  }
  return {
    ok: false,
    message: message ?? `The crew could not be chartered (${res.status}).`,
  };
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
  await sdk.threads.send({ threadId, input, mode: "auto" });
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
const creatingProjects = new Set<string>();
const creatingListeners = new Set<() => void>();

function markCreating(projectId: string, active: boolean): void {
  if (active) creatingProjects.add(projectId);
  else creatingProjects.delete(projectId);
  for (const listener of creatingListeners) listener();
}

function subscribeCreating(listener: () => void): () => void {
  creatingListeners.add(listener);
  return () => {
    creatingListeners.delete(listener);
  };
}

const anyCreating = () => creatingProjects.size > 0;
const neverCreating = () => false;

export function useCreateCrew(): {
  /** Name the project the crew is FOR; omit only when it has no code yet. */
  createCrew: (forProjectId?: string, openingRequest?: string) => void;
  creating: boolean;
  error: string | null;
} {
  const navigate = useNavigate();
  // Read from the shared set, so every button that can start a crew shows the
  // one in flight — including the ones that did not start it.
  const creating = useSyncExternalStore(
    subscribeCreating,
    anyCreating,
    neverCreating,
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
          if (owned) {
            await sendRootOpening({
              threadId: owned.id,
              bootstrap: null,
              openingRequest,
            });
            navigate(
              getThreadRoutePath({
                projectId: owned.projectId ?? PERSONAL_PROJECT_ID,
                threadId: owned.id,
              }),
            );
            return;
          }

          const unfinished = threads.find(
            (t) =>
              !t.parentThreadId &&
              UNNAMED_ROOT_TITLES.includes(t.title ?? "") &&
              (t.projectId ?? PERSONAL_PROJECT_ID) === wantedProjectId,
          );
          if (unfinished) {
            // A root found this way may be a standby whose charter failed last
            // time, so the charter is retried before anything else. It is
            // idempotent under the same task id, and a thread that is already
            // crew comes back as the success it is.
            const rootProjectId = unfinished.projectId ?? PERSONAL_PROJECT_ID;
            const chartered = await charterRoot(
              unfinished.id,
              rootProjectId,
              await loadRootBootstrap(),
              rootTaskId(rootProjectId),
            );
            if (!chartered.ok) {
              setError(chartered.message);
              return;
            }
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
          // So: the caller names the project. Only when nothing is named do we
          // fall back to Personal, which is right for a crew that has no code yet
          // and is the one case where "talks only" is the whole story.
          const projects = (await (
            await fetch("/api/v1/projects?includePersonal=true")
          ).json()) as ProjectRow[] | { projects?: ProjectRow[] };
          const list = Array.isArray(projects)
            ? projects
            : (projects.projects ?? []);
          const projectId =
            (forProjectId && list.find((p) => p.id === forProjectId)?.id) ??
            list.find((p) => p.id === PERSONAL_PROJECT_ID)?.id ??
            list.find((p) => p.kind === "personal")?.id ??
            list[0]?.id;
          if (!projectId) {
            setError(
              "No project is registered on this rig yet, so a crew cannot be started.",
            );
            return;
          }
          const isPersonalProject = projectId === PERSONAL_PROJECT_ID;

          const hosts = await readJson<unknown>("/api/v1/hosts");
          const hostList = (
            Array.isArray(hosts)
              ? hosts
              : ((hosts as { hosts?: unknown[] })?.hosts ?? [])
          ) as { id?: string }[];
          const hostId = hostList[0]?.id;
          if (!hostId) {
            setError("No host is connected, so a crew cannot be started yet.");
            return;
          }

          const res = await fetch("/api/v1/threads", {
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
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              message?: string;
            } | null;
            setError(
              body?.message ?? `Could not start the crew (${res.status}).`,
            );
            return;
          }
          const thread = (await res.json()) as {
            id: string;
            projectId?: string;
          };
          const rootProjectId = thread.projectId ?? projectId;

          const chartered = await charterRoot(
            thread.id,
            rootProjectId,
            await loadRootBootstrap(),
            rootTaskId(rootProjectId),
          );
          if (!chartered.ok) {
            // The standby root stays, still holding nothing but the instruction
            // to wait: the next press finds it by title and retries the charter.
            // Navigating into it here would present a loose thread as a crew
            // root, which is the thing the charter exists to prevent.
            setError(chartered.message);
            return;
          }

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

  return { createCrew, creating, error };
}
