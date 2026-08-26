import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { SettingsSection } from "@/components/ui/settings-section.js";
import {
  useClearFleetDefault,
  useFleetDefault,
  useSetFleetDefault,
  type FleetDefaultProvider,
  type FleetDefaultState,
} from "@/hooks/queries/fleet-default";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";
import { useNow } from "@/hooks/useNow";
import { formatRelativeTime } from "@/lib/relative-time";

function providerLabel(
  providers: readonly FleetDefaultProvider[],
  providerId: string,
): string {
  const match = providers.find((provider) => provider.id === providerId);
  return match?.displayName ?? providerId;
}

/**
 * What a new agent gets when nobody chooses for it.
 *
 * THE STORE IS THE ANSWER. A fleet default is saved (crew_defaults) and it is
 * what a new agent actually gets. bb's own last-moment resolution is the
 * fallback for an instance with nothing saved — and only then. This screen
 * used to show that fallback unconditionally, over a store that had held a
 * different pair since the provider adoption, so it told the operator a new
 * agent would get a harness the fleet had retired.
 *
 * The four states of the read are kept apart on purpose: a read that failed
 * must never render as "nothing is stored", because that is the exact mistake
 * that made this screen wrong.
 */
export function DefaultsSettingsSection() {
  const now = useNow(30_000);
  const fleetDefault = useFleetDefault();
  const setDefault = useSetFleetDefault();
  const clearDefault = useClearFleetDefault();
  const state: FleetDefaultState | undefined = fleetDefault.data;

  const providers =
    state && (state.kind === "stored" || state.kind === "none")
      ? state.providers
      : [];

  const [draftProvider, setDraftProvider] = useState<string | null>(null);
  const providerChoice =
    draftProvider ?? (state?.kind === "stored" ? state.providerId : null);

  // Only the chosen provider's catalogue: previewing one harness must never
  // offer another's models as if they were interchangeable.
  const catalogue = useSystemExecutionOptions(
    providerChoice ? { providerId: providerChoice } : { enabled: false },
  );
  const models = providerChoice ? (catalogue.data?.models ?? []) : [];
  const modelLabel = (modelId: string): string =>
    models.find((model) => model.model === modelId)?.displayName ?? modelId;

  const [draftModel, setDraftModel] = useState<string | null>(null);
  const modelChoice =
    draftModel ??
    (state?.kind === "stored" && providerChoice === state.providerId
      ? state.modelId
      : null);

  // The no-store fallback, asked for ONLY when there is genuinely no store to
  // report. Enabled by the state, not by the render, so an instance with a
  // saved default never pays for a probe whose answer it must not show.
  const fallback = useSystemExecutionOptions(
    state?.kind === "none" ? {} : { enabled: false },
  );

  const writeError = setDefault.data?.error ?? clearDefault.data?.error ?? null;
  const busy = setDefault.isPending || clearDefault.isPending;
  // The sentence form ("just now", "3h ago"), not the Tower's compact one: a
  // default saved a second ago should not read "0s ago".
  const setAt =
    state?.kind === "stored" ? Date.parse(state.setAt) : Number.NaN;
  const setAge = Number.isFinite(setAt)
    ? formatRelativeTime({ timestamp: setAt, now })
    : null;

  return (
    <SettingsSection
      title="Defaults for new agents"
      description="The coding harness and model an agent gets when nothing is chosen for it."
    >
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Right now, a new agent would get
        </p>
        <div className="rounded-lg border border-border p-4">
          {fleetDefault.isPending ? (
            <p className="text-sm text-muted-foreground">
              Reading the saved default…
            </p>
          ) : state?.kind === "stored" ? (
            <div className="space-y-1.5">
              <p className="text-sm text-foreground">
                <span className="font-medium">
                  {providerLabel(state.providers, state.providerId)}
                </span>
                {" · "}
                <span className="font-medium">
                  {modelLabel(state.modelId)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Saved{state.setBy ? ` by ${state.setBy}` : ""}
                {setAge ? `, ${setAge}` : ""}. This is the stored answer, not a
                guess.
              </p>
            </div>
          ) : state?.kind === "none" ? (
            <div className="space-y-1.5">
              {fallback.isPending ? (
                <p className="text-sm text-muted-foreground">
                  Nothing is saved — asking the instance what it would resolve…
                </p>
              ) : fallback.isError ? (
                <p className="text-sm text-muted-foreground">
                  Nothing is saved, and the instance would not say what it would
                  resolve instead.
                </p>
              ) : (
                <>
                  <p className="text-sm text-foreground">
                    <span className="font-medium">
                      {fallback.data?.providers?.[0]?.displayName ??
                        "no provider"}
                    </span>
                    {(() => {
                      const resolved =
                        fallback.data?.models?.find((m) => m.isDefault) ??
                        fallback.data?.models?.[0];
                      return resolved ? (
                        <>
                          {" · "}
                          <span className="font-medium">
                            {resolved.displayName ?? resolved.model}
                          </span>
                        </>
                      ) : null;
                    })()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Nothing is saved, so this is what the instance resolves at
                    the moment an agent is created. Save one below to stop it
                    drifting.
                  </p>
                </>
              )}
            </div>
          ) : state?.kind === "refused" ? (
            <p className="text-sm text-muted-foreground">{state.error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {state?.kind === "unreadable" && state.timedOut
                ? "The saved default did not answer in time, so this cannot be shown yet."
                : "The saved default could not be read, so this cannot be shown."}{" "}
              Rather than guess, this screen says nothing.
            </p>
          )}
        </div>
      </div>

      {state?.kind === "stored" && state.providersError ? (
        <p className="text-xs text-muted-foreground">
          The saved pair is shown as stored, but this instance&rsquo;s harness
          list could not be read ({state.providersError}), so whether it is still
          available is unknown.
        </p>
      ) : null}

      {state?.kind === "stored" || state?.kind === "none" ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface-raised p-5">
          <div className="flex items-start gap-3">
            <Icon
              name="SlidersHorizontal"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <p className="text-sm font-medium text-foreground">
              {state.kind === "stored"
                ? "Change the saved default"
                : "Save a default"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  {providerChoice
                    ? providerLabel(providers, providerChoice)
                    : "Choose a harness"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" mobileTitle="Harness">
                {providers.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onSelect={() => {
                      setDraftProvider(provider.id);
                      setDraftModel(null);
                    }}
                  >
                    {provider.displayName ?? provider.id}
                    {provider.available ? "" : " (unavailable)"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !providerChoice}
                >
                  {modelChoice
                    ? modelLabel(modelChoice)
                    : (catalogue.isPending && providerChoice
                        ? "Reading models…"
                        : "Choose a model")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" mobileTitle="Model">
                {models.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {catalogue.isPending
                      ? "Reading models…"
                      : "This harness listed none."}
                  </DropdownMenuItem>
                ) : (
                  models.map((model) => (
                    <DropdownMenuItem
                      key={model.model}
                      onSelect={() => setDraftModel(model.model)}
                    >
                      {model.displayName ?? model.model}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              disabled={busy || !providerChoice || !modelChoice}
              onClick={() => {
                if (!providerChoice || !modelChoice) return;
                clearDefault.reset();
                setDefault.mutate({
                  providerId: providerChoice,
                  modelId: modelChoice,
                });
              }}
            >
              {setDefault.isPending ? "Saving…" : "Save"}
            </Button>

            {state.kind === "stored" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDefault.reset();
                  setDraftProvider(null);
                  setDraftModel(null);
                  clearDefault.mutate();
                }}
              >
                {clearDefault.isPending ? "Clearing…" : "Clear"}
              </Button>
            ) : null}
          </div>

          {writeError ? (
            <p className="text-sm text-destructive">{writeError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Coding harnesses this instance knows
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {providers.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">
              {fleetDefault.isPending
                ? "Asking the instance…"
                : state?.kind === "stored" || state?.kind === "none"
                  ? "The instance listed none."
                  : "This list could not be read."}
            </li>
          ) : (
            providers.map((provider) => (
              <li
                key={provider.id}
                className="flex items-center justify-between gap-4 p-3.5"
              >
                <span className="min-w-0 text-sm text-foreground">
                  {provider.displayName ?? provider.id}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {provider.available ? "available" : "unavailable"}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </SettingsSection>
  );
}

export default DefaultsSettingsSection;
