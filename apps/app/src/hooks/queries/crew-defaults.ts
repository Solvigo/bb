import { useQuery, type QueryKey } from "@tanstack/react-query";

const CREW_DEFAULTS_QUERY_KEY: QueryKey = ["crew-defaults"];
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
 */
async function fetchCrewDefaults(
  signal: AbortSignal,
): Promise<CrewDefaultsResult | null> {
  const timeoutSignal = AbortSignal.timeout(CREW_DEFAULTS_TIMEOUT_MS);
  try {
    const response = await fetch("/api/v1/plugins/crew/rpc/crew_defaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
      signal: AbortSignal.any([signal, timeoutSignal]),
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as {
      ok?: boolean;
      result?: unknown;
    };
    if (envelope.ok !== true) return null;
    return parseCrewDefaultsResult(envelope.result);
  } catch {
    return null;
  }
}

export function crewDefaultsQueryKey(): QueryKey {
  return CREW_DEFAULTS_QUERY_KEY;
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
