import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import charter from "./crewSetupCharter.md?raw";

/** A commander runs on the reasoning tier; the retired provider is never it. */
const COMMANDER_PROVIDER_ID = "claude-code";
/** Used only when the provider's model catalog is too slow to answer. */
const COMMANDER_FALLBACK_MODEL = "claude-opus-5[1m]";

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

        const start = (model?: string) =>
          fetch("/api/v1/threads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              origin: "app",
              title: "New crew · setup",
              // Pin the provider rather than taking the project default: the
              // default here resolved to a RETIRED provider whose token no
              // longer refreshes, so the commander failed on its first turn
              // before it could say a word.
              providerId: COMMANDER_PROVIDER_ID,
              ...(model ? { model } : {}),
              environment: { type: "project-default" },
              input: [{ type: "text", text: charter, mentions: [] }],
            }),
          });

        let res = await start();
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            code?: string;
            message?: string;
          } | null;
          // Resolving the provider's default model can time out on a loaded
          // machine. Naming a model skips that lookup, so retry once rather
          // than failing the Captain's first press.
          if (body?.code === "model_catalog_unavailable") {
            res = await start(COMMANDER_FALLBACK_MODEL);
          }
          if (!res.ok) {
            const retryBody = (await res.json().catch(() => null)) as {
              message?: string;
            } | null;
            setError(
              retryBody?.message ??
                body?.message ??
                `Could not start the crew (${res.status}).`,
            );
            return;
          }
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
