import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchWithAppSurface } from "@/lib/app-surface";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { crewDefaultsQueryKey, fleetDefaultQueryKey } from "./query-keys";

const CREW_PLUGIN_ID = "crew";
const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 15_000;

export interface FleetDefaultProvider {
  id: string;
  displayName: string | null;
  available: boolean;
}

/**
 * What the store says, kept as four separate answers rather than one nullable
 * pair.
 *
 * "Nothing is stored" and "I could not find out" are different facts, and the
 * Defaults screen showed bb's own resolution as the answer for months because
 * the only reader collapsed them — a preload hint may treat every failure as
 * absence, a screen that tells the operator what a new agent will get may not.
 */
export type FleetDefaultState =
  | {
      kind: "stored";
      providerId: string;
      modelId: string;
      setAt: string;
      setBy: string;
      providers: readonly FleetDefaultProvider[];
      providersError: string | null;
    }
  | {
      kind: "none";
      providers: readonly FleetDefaultProvider[];
      providersError: string | null;
    }
  | { kind: "refused"; error: string }
  | { kind: "unreadable"; timedOut: boolean };

function parseProviders(value: unknown): FleetDefaultProvider[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const provider = entry as Record<string, unknown>;
    if (typeof provider.id !== "string") return [];
    return [
      {
        id: provider.id,
        // The store's own schema allows a null display name; requiring a string
        // here would silently drop that provider from the picker.
        displayName:
          typeof provider.displayName === "string" ? provider.displayName : null,
        available: provider.available === true,
      },
    ];
  });
}

function parseFleetDefault(value: unknown): FleetDefaultState {
  if (typeof value !== "object" || value === null) {
    return { kind: "unreadable", timedOut: false };
  }
  const result = value as Record<string, unknown>;
  if (result.ok !== true) {
    return {
      kind: "refused",
      error:
        typeof result.error === "string"
          ? result.error
          : "The store refused the read without saying why.",
    };
  }
  const providers = parseProviders(result.providers);
  const providersError =
    typeof result.providersError === "string" ? result.providersError : null;
  const stored = result.stored;
  if (typeof stored !== "object" || stored === null) {
    return { kind: "none", providers, providersError };
  }
  const row = stored as Record<string, unknown>;
  if (typeof row.providerId !== "string" || typeof row.modelId !== "string") {
    return { kind: "unreadable", timedOut: false };
  }
  return {
    kind: "stored",
    providerId: row.providerId,
    modelId: row.modelId,
    setAt: typeof row.setAt === "string" ? row.setAt : "",
    setBy: typeof row.setBy === "string" ? row.setBy : "",
    providers,
    providersError,
  };
}

async function callDefaults(
  method: string,
  input: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  return callPluginRpc(
    (url, init) => fetchWithAppSurface(url, { ...init, signal: combined }),
    CREW_PLUGIN_ID,
    method,
    input,
  );
}

/**
 * The stored fleet default, for a surface that must tell the operator the
 * truth about it. Never throws and never resolves to undefined data: every
 * outcome is one of the four states above, so a caller cannot accidentally
 * render "nothing is stored" over a read that failed.
 */
export function useFleetDefault() {
  return useQuery<FleetDefaultState>({
    queryKey: fleetDefaultQueryKey(),
    queryFn: async ({ signal }) => {
      try {
        return parseFleetDefault(
          await callDefaults("crew_defaults", null, READ_TIMEOUT_MS, signal),
        );
      } catch (error) {
        return {
          kind: "unreadable",
          timedOut:
            error instanceof DOMException && error.name === "TimeoutError",
        };
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

export interface FleetDefaultWriteResult {
  ok: boolean;
  error: string | null;
}

function parseWrite(value: unknown): FleetDefaultWriteResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "The store gave no answer." };
  }
  const result = value as Record<string, unknown>;
  if (result.ok === true) return { ok: true, error: null };
  return {
    ok: false,
    // The refusal sentence is written by the store, which owns every rule about
    // what may be saved. Passing it through verbatim is the only way the screen
    // and the terminal give the same reason.
    error:
      typeof result.error === "string"
        ? result.error
        : "The store refused the change without saying why.",
  };
}

export function useSetFleetDefault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pair: { providerId: string; modelId: string }) =>
      parseWrite(
        await callDefaults("crew_defaults_set", pair, WRITE_TIMEOUT_MS),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fleetDefaultQueryKey() });
      void queryClient.invalidateQueries({ queryKey: crewDefaultsQueryKey() });
    },
  });
}

export function useClearFleetDefault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      parseWrite(
        await callDefaults("crew_defaults_clear", null, WRITE_TIMEOUT_MS),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fleetDefaultQueryKey() });
      void queryClient.invalidateQueries({ queryKey: crewDefaultsQueryKey() });
    },
  });
}
