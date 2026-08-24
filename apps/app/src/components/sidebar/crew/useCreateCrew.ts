import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import charter from "./crewSetupCharter.md?raw";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { AGENT_PROVIDER } from "@/lib/agentProvider";

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
  createCrew: () => void;
  creating: boolean;
  error: string | null;
} {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createCrew = useCallback(() => {
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
        ) as { id: string; title?: string | null; parentThreadId?: string | null }[];
        const unfinished = threads.find(
          (t) => !t.parentThreadId && t.title === SETUP_THREAD_TITLE,
        );
        if (unfinished) {
          navigate(`/threads/${unfinished.id}`);
          return;
        }

        // The setup commander only talks, so it belongs on the Personal
        // project, which is repo-less by construction. The projects read HIDES
        // Personal unless asked for it — without the flag the first project on
        // this rig is repo-backed, which is what dragged a full worktree into a
        // conversation that never needed one.
        const projects = (await (
          await fetch("/api/v1/projects?includePersonal=true")
        ).json()) as ProjectRow[] | { projects?: ProjectRow[] };
        const list = Array.isArray(projects) ? projects : (projects.projects ?? []);
        const projectId =
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
          setError(body?.message ?? `Could not start the crew (${res.status}).`);
          return;
        }
        const thread = (await res.json()) as { id: string };
        navigate(`/threads/${thread.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start the crew.");
      } finally {
        setCreating(false);
      }
    })();
  }, [creating, navigate]);

  return { createCrew, creating, error };
}
