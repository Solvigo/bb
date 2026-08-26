import {
  normalizeCustomServerUrl,
  type ServerTargetStore,
} from "./server-target.js";
import type { ServerProbeResult } from "./server-probe.js";

/** Env var the packaged Captain build bakes into Info.plist LSEnvironment. */
export const BB_DESKTOP_ATTACH_URL_ENV = "BB_DESKTOP_ATTACH_URL";

interface ResolveEnvAttachServerUrlArgs {
  env: NodeJS.ProcessEnv;
}

/**
 * When set, the desktop shell must attach to this bb server and must never
 * spawn its bundled bb-app runtime (the two-instances hazard).
 */
export function resolveEnvAttachServerUrl(
  args: ResolveEnvAttachServerUrlArgs,
): string | null {
  const rawAttachUrl = args.env[BB_DESKTOP_ATTACH_URL_ENV]?.trim();
  if (rawAttachUrl !== undefined && rawAttachUrl.length > 0) {
    return normalizeCustomServerUrl(rawAttachUrl);
  }

  const rawServerUrl = args.env.BB_SERVER_URL?.trim();
  if (rawServerUrl !== undefined && rawServerUrl.length > 0) {
    return normalizeCustomServerUrl(rawServerUrl);
  }

  const rawPort = args.env.BB_SERVER_PORT?.trim();
  if (rawPort === undefined || rawPort.length === 0) {
    return null;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }

  return normalizeCustomServerUrl(`http://127.0.0.1:${port}`);
}

export function isAttachOnlyConfigured(
  args: ResolveEnvAttachServerUrlArgs,
): boolean {
  return resolveEnvAttachServerUrl(args) !== null;
}

interface ApplyEnvAttachServerTargetArgs {
  env: NodeJS.ProcessEnv;
  store: ServerTargetStore;
}

/** Pin the active target to the configured attach URL when one is present. */
export async function applyEnvAttachServerTarget(
  args: ApplyEnvAttachServerTargetArgs,
): Promise<void> {
  const attachUrl = resolveEnvAttachServerUrl({ env: args.env });
  if (attachUrl === null) {
    return;
  }
  await args.store.setCustomServerUrl(attachUrl);
}

export function formatAttachProbeFailureMessage(
  serverUrl: string,
  probe: Exclude<ServerProbeResult, { kind: "compatible" }>,
): string {
  if (probe.kind === "unavailable") {
    return (
      `No bb server is reachable at ${serverUrl} (${probe.reason}). ` +
      "Start your bb instance or fix BB_SERVER_URL / BB_DESKTOP_ATTACH_URL, " +
      "then reopen the desktop app. The shell will not start a bundled server " +
      "while an attach URL is configured."
    );
  }
  return (
    `${serverUrl} is reachable but is not a compatible bb server: ${probe.reason}. ` +
    "Fix the configured attach URL, then reopen the desktop app."
  );
}

interface ResolveElectronBuilderAttachEnvironmentArgs {
  env: NodeJS.ProcessEnv;
}

/** LSEnvironment entries baked into the macOS .app for attach-only launches. */
export function resolveElectronBuilderAttachEnvironment(
  args: ResolveElectronBuilderAttachEnvironmentArgs,
): Record<string, string> | null {
  const attachUrl = resolveEnvAttachServerUrl({ env: args.env });
  if (attachUrl === null) {
    return null;
  }
  return {
    [BB_DESKTOP_ATTACH_URL_ENV]: attachUrl,
    BB_DESKTOP_AUTO_UPDATE: "0",
    BB_DESKTOP_VERSION_CHECK: "0",
  };
}
