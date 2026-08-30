import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import rootBootstrap from "./rootAgentBootstrap.md?raw";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { AGENT_PROVIDER } from "@/lib/agentProvider";
import { getThreadRoutePath } from "@/lib/route-paths";
import { sdk } from "@/lib/sdk";

interface ProjectRow {
  id: string;
  kind?: string;
}

/** A root keeps this title until its crew is named — that is how a second
 *  press finds the unnamed root instead of starting another. The wizard's old
 *  title is still matched so a root created before the interview was retired
 *  is resumed rather than duplicated. */
const ROOT_THREAD_TITLE = "New crew";
const UNNAMED_ROOT_TITLES = [ROOT_THREAD_TITLE, "New crew · setup"];

/** The root's first input, before it is anything. It is not the brief: the
 *  brief goes out only once the charter has made this a crew root. */
const STANDBY_INPUT =
  "Stand by. You are being chartered as this project's root agent and will " +
  "receive your brief in a moment. Do not start any work yet.";

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The task id a project's root is chartered under. Deterministic on purpose:
 *  a retry after a failed charter charters the SAME work, not a second one. */
function rootTaskId(projectId: string): string {
  return `root-${projectId}`;
}

interface CharterOutcome {
  ok: boolean;
  /** True when this thread was already crew, which is a success for a retry. */
  already: boolean;
  message: string | null;
}

/**
 * Turn a standby root into a governed crew root.
 *
 * The plugin refuses rather than throwing for anything the operator can act
 * on, and wraps its payload the way every other crew verb does — so read the
 * inner result when it is there, and treat a refusal that says the thread is
 * already crew as the success it is for a retry.
 */
async function charterRoot(
  threadId: string,
  briefText: string,
  taskId: string,
): Promise<CharterOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/v1/plugins/crew/rpc/crew_charter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, briefText, taskId }),
    });
  } catch {
    return {
      ok: false,
      already: false,
      message: "The crew plugin did not answer.",
    };
  }
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    message?: string;
    result?: { ok?: boolean; error?: string; message?: string };
  } | null;
  const result = body?.result ?? body ?? {};
  const message = result.error ?? result.message ?? null;
  // Narrow on purpose. "is already crew" is this thread, already chartered —
  // a success for a retry. "this project already has a crew" is a different
  // thread holding the one crew slot, and that is a refusal.
  const already =
    message !== null && /already crew|chartered twice/i.test(message);
  if (already) return { ok: true, already: true, message: null };
  if (!res.ok || result.ok === false || (result.ok === undefined && message)) {
    return {
      ok: false,
      already: false,
      message: message ?? `The crew could not be chartered (${res.status}).`,
    };
  }
  return { ok: true, already: false, message: null };
}

/**
 * What a chartered root is told: its brief, then what the Captain actually
 * asked for. One send, so the two cannot arrive as separate turns and have the
 * root answer the brief before it has read the request.
 */
async function sendRootOpening({
  threadId,
  includeBootstrap,
  openingRequest,
}: {
  threadId: string;
  includeBootstrap: boolean;
  openingRequest?: string;
}): Promise<void> {
  const request = openingRequest?.trim();
  const input = [
    ...(includeBootstrap
      ? [{ type: "text" as const, text: rootBootstrap, mentions: [] }]
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
export function useCreateCrew(): {
  /** Name the project the crew is FOR; omit only when it has no code yet. */
  createCrew: (forProjectId?: string, openingRequest?: string) => void;
  creating: boolean;
  error: string | null;
} {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createCrew = useCallback(
    (forProjectId?: string, openingRequest?: string) => {
      if (creating) return;
      setCreating(true);
      setError(null);
      void (async () => {
        try {
          // IDEMPOTENCY: a second press must RESUME the unfinished setup rather
          // than leave another husk on the rail. Three "New crew · setup" crews
          // with no leads is what repeated presses produced before this.
          const existing = await readJson<unknown>(
            "/api/v1/threads?archived=false",
          );
          const threads = (
            Array.isArray(existing)
              ? existing
              : ((existing as { threads?: unknown[] })?.threads ??
                (existing as { data?: unknown[] })?.data ??
                [])
          ) as {
            id: string;
            projectId?: string;
            title?: string | null;
            parentThreadId?: string | null;
          }[];
          // Scoped to the project asked for, because a root is born on its
          // project and can never move: resuming Personal's unnamed root when
          // the press came from a repo-backed project hands back an agent that
          // can talk and can never dispatch for the project clicked.
          const wantedProjectId = forProjectId ?? PERSONAL_PROJECT_ID;
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
              rootBootstrap,
              rootTaskId(rootProjectId),
            );
            if (!chartered.ok) {
              setError(chartered.message);
              return;
            }
            await sendRootOpening({
              threadId: unfinished.id,
              // Only a root that had never been chartered still needs its
              // brief; one that was already crew has been carrying it since it
              // was chartered, and sending it twice reads as a second order.
              includeBootstrap: !chartered.already,
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
            rootBootstrap,
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
            includeBootstrap: !chartered.already,
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
          setCreating(false);
        }
      })();
    },
    [creating, navigate],
  );

  return { createCrew, creating, error };
}
