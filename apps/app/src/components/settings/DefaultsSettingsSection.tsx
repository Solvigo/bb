import { Icon } from "@bb/shared-ui/icon";
import { SettingsSection } from "@/components/ui/settings-section.js";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";

/**
 * What a new agent gets when nobody chooses for it.
 *
 * bb stores no default provider: it resolves one at the moment a thread is
 * created, by asking whichever provider it lands on for its model catalogue.
 * This screen is read-only for exactly that reason — there is no stored value
 * to edit yet. It shows what that resolution produces right now, because the
 * answer has repeatedly been a provider this fleet retired, and an operator who
 * cannot see the default cannot notice it drifting.
 */
export function DefaultsSettingsSection() {
  // No providerId: this is the resolution a new agent gets with nothing chosen.
  const unscoped = useSystemExecutionOptions({});
  const providers = unscoped.data?.providers ?? [];
  const models = unscoped.data?.models ?? [];
  const resolvedModel = models.find((m) => m.isDefault) ?? models[0];
  const resolvedProvider = providers[0];

  return (
    <SettingsSection
      title="Defaults for new agents"
      description="The coding harness and model an agent gets when nothing is chosen for it."
    >
      <div className="rounded-lg border border-border bg-surface-raised p-5">
        <div className="flex items-start gap-3">
          <Icon
            name="SlidersHorizontal"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="space-y-2.5 text-sm">
            <p className="font-medium text-foreground">
              Nothing is stored yet — this is what would be resolved
            </p>
            <p className="leading-relaxed text-muted-foreground">
              Solvigo Airways has no saved default to show you. It picks one at the moment an
              agent is created, by asking a provider for its catalogue. Below is
              the answer that resolution gives on this instance right now.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Right now, a new agent would get
        </p>
        <div className="rounded-lg border border-border p-4">
          {unscoped.isPending ? (
            <p className="text-sm text-muted-foreground">Asking the instance…</p>
          ) : unscoped.isError ? (
            <p className="text-sm text-muted-foreground">
              The instance would not answer, so this default cannot be shown.
              That is itself the problem this screen exists to make visible.
            </p>
          ) : (
            <p className="text-sm text-foreground">
              <span className="font-medium">
                {resolvedProvider?.displayName ?? "no provider"}
              </span>
              {resolvedModel ? (
                <>
                  {" · "}
                  <span className="font-medium">
                    {resolvedModel.displayName ?? resolvedModel.model}
                  </span>
                </>
              ) : null}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Coding harnesses this instance knows
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {providers.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">
              {unscoped.isPending
                ? "Asking the instance…"
                : "The instance listed none."}
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
