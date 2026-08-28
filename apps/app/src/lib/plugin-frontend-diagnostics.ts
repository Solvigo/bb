/**
 * The plugin-frontend diagnostics store, deliberately alone in this file.
 *
 * It lives apart from the loader because reading it must not cost what the
 * loader costs. `plugin-frontend.ts` namespace-imports the ENTIRE plugin
 * runtime — React, radix, tiptap, shiki, katex — because that is the surface it
 * hands to plugin bundles. Anything on the boot path that imported it to ask a
 * one-line question dragged all of that into the boot payload; the bundle
 * budget caught exactly that and was right to.
 *
 * So: publishers import the loader, readers import this.
 */

export interface PluginFrontendFailure {
  phase: "load" | "setup" | "mount" | "dispose";
  message: string;
  scriptId: string | null;
}

export interface PluginFrontendActiveGenerationDiagnostic {
  generation: number;
  hash: string;
  contentScriptIds: readonly string[];
}

/** Per-window frontend lifecycle state shown in plugin diagnostics. */
export type PluginFrontendDiagnostic =
  | {
      pluginId: string;
      status: "active";
      active: PluginFrontendActiveGenerationDiagnostic;
      lastFailure: PluginFrontendFailure | null;
    }
  | {
      pluginId: string;
      status: "failed";
      active: PluginFrontendActiveGenerationDiagnostic | null;
      lastFailure: PluginFrontendFailure;
    }
  | {
      pluginId: string;
      status: "needs-update";
      active: PluginFrontendActiveGenerationDiagnostic | null;
      sdkMajor: number;
      sdkVersion: string;
      lastFailure: null;
    };

let snapshot: ReadonlyMap<string, PluginFrontendDiagnostic> = new Map();
const listeners = new Set<() => void>();

/** Replace the published snapshot and wake every reader. Loader-side only. */
export function setPluginFrontendDiagnostics(
  next: ReadonlyMap<string, PluginFrontendDiagnostic>,
): void {
  snapshot = new Map(next);
  for (const listener of listeners) listener();
}

/** Current per-window lifecycle diagnostics for plugin frontend generations. */
export function getPluginFrontendDiagnostics(): ReadonlyMap<
  string,
  PluginFrontendDiagnostic
> {
  return snapshot;
}

/** Subscribe to per-window frontend diagnostic changes. */
export function subscribePluginFrontendDiagnostics(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
