import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import charter from "./crewSetupCharter.md?raw";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { AGENT_PROVIDER } from "@/lib/agentProvider";
import { getThreadRoutePath } from "@/lib/route-paths";

/** A setup thread keeps this title until its crew is named — that is how a
 *  second press finds the unfinished interview instead of starting another. */
interface ProjectRow {
  id: string;
  kind?: string;
}

const SETUP_THREAD_TITLE = "New crew · setup";

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Pressing NEW CREW spawns a fresh COMMANDER thread seeded with the setup
 * charter and lands the Captain in that chat, where the commander interviews
 * him and builds the crew for real as they agree each step.
 *
 * The charter lives in its own file (crewSetupCharter.md) because it IS the
 * journey — it should be iterated like any other reviewable surface, not buried
 * as a string literal in a component.
 */
export function useCreateCrew(): {
  /** Name the project the crew is FOR; omit only when it has no code yet. */
  createCrew: (forProjectId?: string) => void;
  creating: boolean;
  error: string | null;
} {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createCrew = useCallback(
    (forProjectId?: string) => {
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
          // Scoped to the project asked for, because a commander is born on its
          // project and can never move: resuming Personal's unfinished setup
          // when the press came from a repo-backed project hands back a crew
          // that can talk and can never dispatch for the project clicked.
          const wantedProjectId = forProjectId ?? PERSONAL_PROJECT_ID;
          const unfinished = threads.find(
            (t) =>
              !t.parentThreadId &&
              t.title === SETUP_THREAD_TITLE &&
              (t.projectId ?? PERSONAL_PROJECT_ID) === wantedProjectId,
          );
          if (unfinished) {
            // Scoped, like every thread link: the projectless route resolves to
            // the Personal project, which happens to be right for a setup
            // commander and would be silently wrong the day it is not.
            navigate(
              getThreadRoutePath({
                projectId: unfinished.projectId ?? PERSONAL_PROJECT_ID,
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
              title: SETUP_THREAD_TITLE,
              // Provider AND model together, from the one shared path. Pinning
              // only the provider still lets the instance resolve its default
              // MODEL — which may belong to a dead provider, which is how this
              // fault survived being "fixed" once already.
              providerId: AGENT_PROVIDER.providerId,
              model: AGENT_PROVIDER.model,
              // The setup thread INTERVIEWS and calls verbs — it never touches a
              // repo, so it must not provision one. A managed worktree cost the
              // Captain ~10 MINUTES of pnpm (2318 packages, 3.7GB) before his
              // commander could say a word, and dragged the whole machine.
              //
              // On Personal that is guaranteed by construction rather than by
              // convention: a personal workspace has no repo to clone. Anywhere
              // else, an unmanaged workspace with no path is the nearest thing —
              // it provisions nothing, but only because it was asked not to.
              // No worktree either way. On Personal that is guaranteed by
              // construction; on a real project an unmanaged workspace with no
              // path provisions nothing while still letting the commander parent
              // leads that DO get worktrees. Measured on the rig: 12 seconds to
              // first word on a repo-backed project, against ten minutes for a
              // managed one.
              environment: {
                type: "host",
                hostId,
                workspace: isPersonalProject
                  ? { type: "personal" }
                  : { type: "unmanaged", path: null },
              },
              input: [{ type: "text", text: charter, mentions: [] }],
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
          navigate(
            getThreadRoutePath({
              projectId: thread.projectId ?? projectId,
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
