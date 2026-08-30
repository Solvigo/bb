import { useCallback, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";

/**
 * Projects with a creation in flight, shared by every instance of this hook.
 *
 * `creating` was per-component state, and the rail button and each project
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

/**
 * Pressing NEW CREW stands up the project's ROOT AGENT.
 *
 * The work itself lives in `createCrewFlow`, imported when the button is
 * pressed: it is network choreography and a brief, none of which renders, and
 * carrying it in the sidebar's boot chunk charged every session for a click
 * most of them never make. What stays here is what a button needs to draw
 * itself — whether a creation is running, and what refused the last one.
 *
 * The order the flow keeps is the contract: a project-bound, worktree-less
 * root created with a STANDBY input only, then chartered, and only once the
 * charter succeeds does it receive the bootstrap brief and the Captain's
 * opening request. A root that could not be chartered is never briefed and
 * never opened — it would be a loose thread wearing a crew's name, with none
 * of the handle, brief, ceiling or lifecycle behind it.
 */
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
      // Scoped to the project asked for, because a root is born on its project
      // and can never move: resuming Personal's unnamed root when the press
      // came from a repo-backed project hands back an agent that can talk and
      // can never dispatch for the project clicked.
      const wantedProjectId = forProjectId ?? PERSONAL_PROJECT_ID;
      if (creatingProjects.has(wantedProjectId)) return;
      markCreating(wantedProjectId, true);
      setError(null);
      void (async () => {
        try {
          const { runCreateCrew } = await import("./createCrewFlow");
          await runCreateCrew({
            forProjectId,
            openingRequest,
            onError: setError,
            onNavigate: navigate,
          });
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
