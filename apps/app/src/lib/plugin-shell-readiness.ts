import { useEffect, useState } from "react";
import { usePluginFrontendsSettled } from "./plugin-frontend-boot-state";

export const PLUGIN_SHELL_READY_TIMEOUT_MS = 2_000;

export function usePluginShellReady(
  timeoutMs: number = PLUGIN_SHELL_READY_TIMEOUT_MS,
): boolean {
  const settled = usePluginFrontendsSettled();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (settled) return;
    const timeout = window.setTimeout(() => setTimedOut(true), timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [settled, timeoutMs]);
  return settled || timedOut;
}
