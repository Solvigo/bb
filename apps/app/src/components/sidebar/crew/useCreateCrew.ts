import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import charter from "./crewSetupCharter.md?raw";
import { AGENT_PROVIDER } from "@/lib/agentProvider";

/** A setup thread keeps this title until its crew is named — that is how a
 *  second press finds the unfinished interview instead of starting another. */
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

        // The commander needs a repo-backed project so its leads get real
        // worktrees; fall back to whatever project exists rather than failing.
        const projects = (await (
          await fetch("/api/v1/projects")
        ).json()) as { id: string }[] | { projects?: { id: string }[] };
        const list = Array.isArray(projects) ? projects : (projects.projects ?? []);
        const projectId = list[0]?.id;
        if (!projectId) {
          setError(
            "No project is registered on this rig yet — a crew needs one so its leads get real worktrees.",
          );
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
            // The setup thread INTERVIEWS and calls verbs. It never touches a
            // repo, so it gets no workspace: provisioning one made the
            // Captain wait ~10 minutes for pnpm before his commander could
            // say a word. Repos are provisioned at DISPATCH, where a wait
            // belongs to a sortie that actually needs one.
            environment: { type: "host", workspace: { type: "personal" } },
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
