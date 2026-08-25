import { useQuery } from "@tanstack/react-query";
import {
  listBuiltInAgentProviderInfos,
  listClaudeCodeFallbackModels,
} from "@bb/agent-providers";
import { toRecord } from "@bb/core-ui";
import type { AvailableModel, ProviderInfo } from "@bb/domain";
import type {
  SystemCliSkillsStatusResponse,
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  OnboardingAgentOverview,
  SystemVersionResponse,
} from "@bb/server-contract";
import type {
  DiscoverReposResult,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import { BbHttpError, sdk } from "@/lib/sdk";
import {
  claudeModelCatalogCacheKey,
  readCachedClaudeModelCatalog,
  writeCachedClaudeModelCatalog,
} from "@/lib/claude-model-catalog-cache";
import {
  useCrewDefaults,
  type CrewDefaultProviderSummary,
  type CrewDefaultsResult,
} from "./crew-defaults";
import { useSystemRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  hostProviderCliStatusQueryKey,
  systemCliSkillsQueryKey,
  onboardingAgentsQueryKey,
  onboardingReposQueryKey,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemUsageLimitsQueryKey,
  systemVersionQueryKey,
} from "./query-keys";
import { requireEnabledQueryArg } from "./query-helpers";
import {
  FOCUS_OWNED_LIVE_QUERY_POLICY,
  SERVER_SESSION_QUERY_POLICY,
  SESSION_STATIC_QUERY_POLICY,
} from "./query-policies";

export interface UseSystemExecutionOptionsArgs {
  enabled?: boolean;
  environmentId?: string;
  hostId?: string;
  providerId?: string;
}

export interface UseOnboardingAgentsOptions extends QueryOptions {
  environmentId?: string;
  hostId?: string;
  poll?: boolean;
}

interface QueryOptions {
  enabled?: boolean;
}

const SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS = 250;
const SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT = 1;
const CLAUDE_CODE_PROVIDER_ID = "claude-code";

// Claude's account-scoped model probe spawns a CLI process on the host, so
// waiting for it leaves the composer with no model list for seconds. Render a
// provisional catalog immediately and let the authoritative rows replace it when
// the probe lands.
//
// Prefer the last catalog this account actually reported: its ids match what the
// fresh probe will return, so a selection made during the preload window
// survives instead of snapping back to a default. The curated aliases are only
// for a cold cache, where no account-scoped ids are known yet.
//
// Callers must gate model recovery on `isPlaceholderData` either way: a cached
// catalog can be stale, so absence from this list is not evidence that a stored
// model was retired.
function claudeCodePlaceholderExecutionOptions(
  cacheKey: string,
): SystemExecutionOptionsResponse {
  const cached = readCachedClaudeModelCatalog(cacheKey);
  return {
    providers: listBuiltInAgentProviderInfos(),
    models: cached?.models ?? listClaudeCodeFallbackModels(),
    selectedOnlyModels: cached?.selectedOnlyModels ?? [],
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

// Fabricated capabilities for a placeholder provider row: conservative
// (nothing beyond the "full" permission mode every provider supports) so a
// provisional row never advertises a capability the real probe might not
// confirm. Real capabilities land the moment the verified catalog does.
function crewDefaultProviderInfo(
  provider: CrewDefaultProviderSummary,
): ProviderInfo {
  return {
    id: provider.id,
    displayName: provider.displayName,
    logoUrl: null,
    capabilities: {
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: false,
      supportsFork: false,
      supportedPermissionModes: ["full"],
    },
    composerActions: [],
    available: provider.available,
  };
}

/**
 * The fleet default pair as a provisional execution-options response, for a
 * provider the claude-code cache doesn't cover (first-ever load with no
 * localStorage entry, a new env/host scope, or a non-claude provider). Same
 * provisional LAW as `claudeCodePlaceholderExecutionOptions`: only a fresh
 * probe may retire this — never treat its absence from a later real catalog
 * as proof the model was removed.
 */
function crewDefaultsPlaceholderExecutionOptions(
  crewDefaults: CrewDefaultsResult,
): SystemExecutionOptionsResponse {
  const knownProviders = crewDefaults.providers.map(crewDefaultProviderInfo);
  const providers = knownProviders.some(
    (provider) => provider.id === crewDefaults.providerId,
  )
    ? knownProviders
    : [
        crewDefaultProviderInfo({
          id: crewDefaults.providerId,
          displayName: crewDefaults.providerId,
          available: true,
        }),
        ...knownProviders,
      ];
  const model: AvailableModel = {
    id: crewDefaults.modelId,
    model: crewDefaults.modelId,
    displayName: crewDefaults.modelId,
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: true,
  };
  return {
    providers,
    models: [model],
    selectedOnlyModels: [],
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

function isAbortLikeError(error: unknown): boolean {
  return toRecord(error)?.name === "AbortError";
}

function shouldRetrySystemExecutionOptions(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT) {
    return false;
  }

  if (isAbortLikeError(error)) {
    return false;
  }

  if (error instanceof BbHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return true;
}

export function useSystemExecutionOptions(
  args: UseSystemExecutionOptionsArgs = {},
) {
  const environmentId = args.environmentId ?? null;
  const hostId = args.hostId ?? null;
  const providerId = args.providerId ?? null;
  const enabled = args.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  const isClaudeCode = providerId === CLAUDE_CODE_PROVIDER_ID;
  const catalogCacheKey = claudeModelCatalogCacheKey({
    environmentId,
    hostId,
  });
  // Covers what the claude cache can't: a first-ever load (no prior probe to
  // have cached), a new env/host scope, and non-claude providers. Only used
  // when the query targets the stored pair's own provider (or no provider is
  // chosen yet) — previewing a different provider must never show this pair's
  // models under the wrong tab.
  const crewDefaultsQuery = useCrewDefaults({ enabled });
  const crewDefaults = crewDefaultsQuery.data ?? null;
  const executionOptionsPlaceholder = isClaudeCode
    ? () => claudeCodePlaceholderExecutionOptions(catalogCacheKey)
    : crewDefaults !== null &&
        (providerId === null || providerId === crewDefaults.providerId)
      ? () => crewDefaultsPlaceholderExecutionOptions(crewDefaults)
      : undefined;

  return useQuery<SystemExecutionOptionsResponse>({
    queryKey: systemExecutionOptionsQueryKey({
      environmentId,
      hostId,
      providerId,
    }),
    queryFn: async ({ signal }) => {
      const response = await sdk.system.executionOptions({
        environmentId: args.environmentId,
        hostId: args.hostId,
        providerId: args.providerId,
        signal,
      });
      // Only a verified catalog is worth remembering. Caching a provisional list
      // would let the server's probe-failure fallback masquerade as this
      // account's real models on the next cold load.
      if (isClaudeCode && response.modelLoadError === null) {
        writeCachedClaudeModelCatalog(catalogCacheKey, {
          models: response.models,
          selectedOnlyModels: response.selectedOnlyModels,
        });
      }
      return response;
    },
    enabled,
    staleTime: 60_000,
    retry: shouldRetrySystemExecutionOptions,
    retryDelay: SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS,
    ...(executionOptionsPlaceholder
      ? { placeholderData: executionOptionsPlaceholder }
      : {}),
  });
}

export function useSystemConfig(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });

  return useQuery<SystemConfigResponse>({
    queryKey: systemConfigQueryKey(),
    queryFn: ({ signal }) => sdk.system.config({ signal }),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Per-machine install state of bb's built-in CLI skills. Each read asks every
 * enrolled machine's daemon, so it is fetched on demand (the settings section)
 * rather than kept fresh in the background.
 */
export function useCliSkillsStatus(options?: QueryOptions) {
  return useQuery<SystemCliSkillsStatusResponse>({
    queryKey: systemCliSkillsQueryKey(),
    queryFn: ({ signal }) => sdk.system.cliSkillsStatus({ signal }),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useSystemVersion(options?: QueryOptions) {
  return useQuery<SystemVersionResponse>({
    queryKey: systemVersionQueryKey(),
    queryFn: ({ signal }) => sdk.system.version({ signal }),
    enabled: options?.enabled ?? true,
    ...SERVER_SESSION_QUERY_POLICY,
  });
}

export interface UseHostProviderCliStatusArgs {
  hostId: string | null;
  enabled?: boolean;
}

export function useHostProviderCliStatus({
  hostId,
  enabled,
}: UseHostProviderCliStatusArgs) {
  return useQuery<ProviderCliStatusResponse>({
    queryKey: hostProviderCliStatusQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.hosts.providerCliStatus({
        hostId: requireEnabledQueryArg({
          value: hostId,
          hookName: "useHostProviderCliStatus",
          argName: "hostId",
        }),
        signal,
      }),
    enabled: (enabled ?? true) && hostId !== null,
    ...SESSION_STATIC_QUERY_POLICY,
  });
}

/**
 * Live agent state for onboarding. Polled while the step is open so installing
 * or signing in from a terminal updates the list without a manual refresh.
 */
export function useOnboardingAgents(options: UseOnboardingAgentsOptions = {}) {
  const environmentId = options.environmentId ?? null;
  const hostId = options.hostId ?? null;
  return useQuery<OnboardingAgentOverview>({
    queryKey: onboardingAgentsQueryKey({ environmentId, hostId }),
    queryFn: ({ signal }) =>
      sdk.system.onboardingAgents({
        environmentId: options.environmentId,
        hostId: options.hostId,
        signal,
      }),
    enabled: options.enabled ?? true,
    // Each read runs CLI health checks, known-agent checks, and up to three
    // provider usage requests, so this polls slowly and only while the agents
    // step is actually on screen. An explicit re-check covers the impatient
    // case. Other readers (the composer's provider default) want one answer.
    ...(options.poll === false
      ? { staleTime: 60_000 }
      : { refetchInterval: 15_000 }),
  });
}

/** Candidate projects on the host. Runs once when the projects step opens. */
export function useOnboardingRepos(options: QueryOptions = {}) {
  return useQuery<DiscoverReposResult>({
    queryKey: onboardingReposQueryKey(),
    queryFn: ({ signal }) => sdk.system.onboardingRepos({ signal }),
    enabled: options.enabled ?? true,
    staleTime: Infinity,
  });
}

export interface UseSystemUsageLimitsArgs extends QueryOptions {
  hostId?: string;
}

export function useSystemUsageLimits(args: UseSystemUsageLimitsArgs = {}) {
  const hostId = args.hostId ?? null;
  return useQuery<ProviderUsageResponse>({
    queryKey: systemUsageLimitsQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.system.usageLimits({
        ...(args.hostId === undefined ? {} : { hostId: args.hostId }),
        signal,
      }),
    enabled: args.enabled ?? true,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}
