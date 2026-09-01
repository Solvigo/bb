import { useEffect, useRef } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { useCreateCrew } from "./useCreateCrew";

/**
 * The refusal from a crew setup, with a named way back.
 *
 * Rendered on the main surface so a failure stays visible when the sidebar is
 * off-screen at a narrow width. Focus lands here after a failed retry so it
 * does not drop to the document body.
 */
export function CrewCreateRecovery({
  className,
}: {
  className?: string;
}) {
  const { createCrew, creating, error, lastAttempt } = useCreateCrew();
  const recoveryRef = useRef<HTMLDivElement>(null);
  const wasCreatingRef = useRef(false);

  useEffect(() => {
    if (wasCreatingRef.current && !creating && error !== null) {
      recoveryRef.current?.focus();
    }
    wasCreatingRef.current = creating;
  }, [creating, error]);

  if (error === null || creating) return null;

  const retry = () => {
    if (lastAttempt === null) return;
    createCrew(lastAttempt.projectId, lastAttempt.openingRequest);
  };

  return (
    <div
      ref={recoveryRef}
      tabIndex={-1}
      data-testid="crew-create-recovery"
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-destructive-text/40 px-2 py-1.5 outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
        className,
      )}
    >
      <p
        role="alert"
        data-testid="crew-create-error"
        className="text-xs text-destructive-text"
      >
        {error}
      </p>
      {lastAttempt !== null ? (
        <button
          type="button"
          data-testid="retry-crew-setup-button"
          aria-label="Retry the unfinished crew setup"
          onClick={retry}
          className="self-start rounded px-1.5 py-0.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Retry setup
        </button>
      ) : null}
    </div>
  );
}
