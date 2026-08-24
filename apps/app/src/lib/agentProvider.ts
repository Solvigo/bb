/**
 * ONE provider-resolution path for every agent thread the app creates.
 *
 * This exists because the same fault bit four separate surfaces: a thread was
 * created without an explicit provider and model, inherited the instance's
 * stale default, and died on its first turn with "access token could not be
 * refreshed" — after the operator had already pressed the button and waited.
 *
 * The rule: never let an agent thread inherit a default. Name the provider AND
 * the model together — a provider pinned without a model still resolves the
 * instance's default model, which can belong to a different (dead) provider,
 * which is exactly how the mismatch survived a "fix".
 */
export interface AgentProvider {
  providerId: string;
  model: string;
}

/**
 * The provider an operator-facing agent runs on. Kept as one constant so a rig
 * with a different working provider is a one-line change, not a hunt through
 * every surface that happens to create a thread.
 */
export const AGENT_PROVIDER: AgentProvider = {
  providerId: "claude-code",
  model: "claude-opus-5[1m]",
};

/** True when a provider/model pair is actually installed on this instance. */
export function isProviderAvailable(
  options: { providers?: { id?: string }[] } | null,
  providerId: string,
): boolean {
  return Boolean(options?.providers?.some((p) => p.id === providerId));
}
