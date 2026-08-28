import { useState, useSyncExternalStore } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  getPluginFrontendDiagnostics,
  subscribePluginFrontendDiagnostics,
} from "@/lib/plugin-frontend";

/**
 * Says out loud that a plugin has no user interface, and why.
 *
 * A slot that throws while rendering leaves a "plugin X crashed" chip where it
 * used to be — the hole is the evidence. A plugin whose REGISTRATION throws
 * leaves nothing at all: every tab, panel and banner it owns is simply absent,
 * the server reports it enabled with no error, and the only trace anywhere is
 * one console warning nobody is watching.
 *
 * That cost a stop-ship: a landed change registered a slot id in the wrong
 * case, took its plugin's whole frontend down with it, and the browser tab
 * vanished from the app while every other signal said healthy.
 *
 * So the absence gets a voice, in the chrome rather than in settings — the
 * failure was already visible on the plugin's settings page, and being visible
 * somewhere nobody was looking is what made it invisible.
 */
export function PluginFrontendFailureNotice() {
  const diagnostics = useSyncExternalStore(
    subscribePluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
    getPluginFrontendDiagnostics,
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const failed = [...diagnostics.values()].filter(
    (diagnostic) =>
      diagnostic.status === "failed" && !dismissed.has(diagnostic.pluginId),
  );
  if (failed.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-2 py-1.5" role="status">
      {failed.map((diagnostic) => (
        <div
          key={diagnostic.pluginId}
          data-testid="plugin-frontend-failure"
          data-plugin-id={diagnostic.pluginId}
          className="flex items-start gap-1.5 rounded-md border border-destructive-text/40 px-2 py-1.5"
        >
          <Icon
            name="AlertTriangle"
            className="mt-0.5 size-3.5 shrink-0 text-destructive-text"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">
              {`${diagnostic.pluginId} has no interface`}
            </p>
            {/* The thrown message verbatim. It named the exact defect the one
                time this mattered — a slot id in the wrong case — and a
                summary would have thrown that away. */}
            <p className="break-words text-[11px] leading-4 text-muted-foreground">
              {diagnostic.lastFailure?.message ??
                "Its frontend failed to register."}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Dismiss the ${diagnostic.pluginId} failure notice`}
            onClick={() =>
              setDismissed((current) =>
                new Set(current).add(diagnostic.pluginId),
              )
            }
            className="shrink-0 rounded p-0.5 text-subtle-foreground transition-colors hover:text-foreground"
          >
            <Icon name="X" className="size-3" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
