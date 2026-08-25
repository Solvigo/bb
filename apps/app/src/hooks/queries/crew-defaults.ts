import { useQuery } from "@tanstack/react-query";
import { fetchWithAppSurface } from "@/lib/app-surface";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { crewDefaultsQueryKey } from "./query-keys";

const CREW_PLUGIN_ID = "crew";
const CREW_DEFAULTS_METHOD = "crew_defaults";
const CREW_DEFAULTS_TIMEOUT_MS = 8_000;

/** The fleet's cheap provider list, as the crew plugin reports it. */
export interface CrewDefaultProviderSummary {
  id: string;
  displayName: string;
  available: boolean;
}

export interface CrewDefaultsResult {
  providerId: string;
  modelId: string;
  providers: readonly CrewDefaultProviderSummary[];
}

function isCrewDefaultProviderSummary(
  value: unknown,
): value is CrewDefaultProviderSummary {
  if (typeof value !== "object" || value === null) return false;
  const provider = value as Record<string, unknown>;
  return (
    typeof provider.id === "string" &&
    typeof provider.displayName === "string" &&
    typeof provider.available === "boolean"
  );
}

function parseCrewDefaultsResult(value: unknown): CrewDefaultsResult | null {
  if (typeof value !== "object" || value === null) return null;
  const result = value as Record<string, unknown>;
  if (result.ok !== true) return null;
  const stored = result.stored;
  if (typeof stored !== "object" || stored === null) return null;
  const storedRecord = stored as Record<string, unknown>;
  if (
    typeof storedRecord.providerId !== "string" ||
    typeof storedRecord.modelId !== "string"
  ) {
    return null;
  }
  return {
    providerId: storedRecord.providerId,
    modelId: storedRecord.modelId,
    providers: Array.isArray(result.providers)
      ? result.providers.filter(isCrewDefaultProviderSummary)
      : [],
  };
}

/**
 * Reads the crew plugin's fleet default provider+model pair, used to preload
 * the composer's model picker before the (13-25s cold) execution-options
 * catalog resolves — see `useSystemExecutionOptions`. The app also runs on
 * vanilla bb, where this plugin is absent, so every failure mode (network
 * error, timeout, non-2xx, malformed body, no stored default yet) returns
 * null rather than throwing: absence of a crew default must never change
 * behavior, only its presence may add a preload.
 *
 * Routed through the shared `callPluginRpc` client (the same one plugin code
 * itself calls via `useRpc()`) rather than a hand-rolled fetch, so this picks
 * up its request/response envelope handling and `encodeURIComponent`ing for
 * free — only the honest timeout is layered on here.
 */
async function fetchCrewDefaults(
  signal: AbortSignal,
): Promise<CrewDefaultsResult | null> {
  const timeoutSignal = AbortSignal.timeout(CREW_DEFAULTS_TIMEOUT_MS);
  const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
  try {
    const result = await callPluginRpc(
      (input, init) =>
        fetchWithAppSurface(input, { ...init, signal: combinedSignal }),
      CREW_PLUGIN_ID,
      CREW_DEFAULTS_METHOD,
      null,
    );
    const parsed = parseCrewDefaultsResult(result);
    // The plugin answered (no throw above), so a parse failure here is not an
    // absent-plugin/network/timeout case — it means the response shape drifted
    // (a renamed or removed field) and the preload has gone silently dark.
    // Behavior is unchanged (still null), but that drift deserves a signal
    // somewhere, since nothing else would ever surface it.
    if (parsed === null) {
      console.debug(
        "[crew-defaults] crew_defaults answered but its result did not match the expected shape",
        result,
      );
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface UseCrewDefaultsOptions {
  enabled?: boolean;
}

/**
 * Fetched once and cached generously: this is a preload hint, not a source of
 * truth, so a stale answer for a minute or two is harmless — the
 * execution-options probe stays the verifier and always wins once it lands.
 */
export function useCrewDefaults(options: UseCrewDefaultsOptions = {}) {
  return useQuery({
    queryKey: crewDefaultsQueryKey(),
    queryFn: ({ signal }) => fetchCrewDefaults(signal),
    enabled: options.enabled ?? true,
    staleTime: 60_000,
    retry: false,
  });
}
