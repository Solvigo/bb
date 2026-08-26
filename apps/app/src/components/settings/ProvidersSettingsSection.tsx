import type { AppSettings } from "@bb/domain";
import { Pill } from "@bb/shared-ui/pill";
import { Switch } from "@bb/shared-ui/switch";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { useFleetDefault } from "@/hooks/queries/fleet-default";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";

/**
 * The bb-native settings a harness has, named by the field that stores them.
 *
 * Read as a fact rather than a guess: these five are the whole of what the
 * app-settings schema carries per provider, and only two harnesses have any.
 * A harness with none is said so out loud — an empty box under a name reads
 * as "we could not load its settings", which is a different claim.
 */
interface ProviderToggle {
  key: keyof AppSettings;
  label: string;
  description: string;
  /** Stored as "disabled", so the switch shows the inverse of the field. */
  inverted?: boolean;
}

const PROVIDER_TOGGLES: Record<string, readonly ProviderToggle[]> = {
  codex: [
    {
      key: "codexMemoryEnabled",
      label: "Memory",
      description:
        "Let Codex recall existing memories and write new ones from bb threads.",
    },
    {
      key: "codexSubagentsDisabled",
      label: "Native subagents",
      description:
        "Codex starts its own subagents. Turn this off and agents delegate through bb instead.",
      inverted: true,
    },
  ],
  "claude-code": [
    {
      key: "claudeCodeMemoryEnabled",
      label: "Memory",
      description:
        "Let Claude Code read and write its native auto-memory for bb threads.",
    },
    {
      key: "claudeCodeSubagentsDisabled",
      label: "Native subagents",
      description:
        "Claude Code's own Task tool. Turn this off and agents delegate through bb instead.",
      inverted: true,
    },
    {
      key: "claudeCodeWorkflowsDisabled",
      label: "Workflow tool",
      description: "Claude Code's native Workflow tool, for bb threads.",
      inverted: true,
    },
  ],
};

/** Provider truth, not preference: shown, never offered as a switch. */
const CAPABILITY_LABELS: Record<string, string> = {
  supportsArchive: "archive",
  supportsRename: "rename",
  supportsServiceTier: "service tier",
  supportsUserQuestion: "ask the operator",
  supportsFork: "fork",
};

export interface ProvidersSettingsSectionProps {
  settings: AppSettings;
  disabled: boolean;
  onSettingsChange: (next: AppSettings) => void;
  /** From /settings/providers/:providerId — the block to scroll to. */
  focusProviderId?: string | null;
}

/**
 * Every coding harness this instance knows, on one screen.
 *
 * ONE PAGE, AND THE LIST IS THE RUNTIME'S. The per-provider pages were islands
 * reached from a hardcoded pair in the settings nav, so an instance that knew
 * four harnesses showed two and the other two could not be seen at all. The
 * list here is whatever the instance reports; nothing about a harness is
 * spelled out in the nav.
 *
 * The old routes still work and land on the harness they name.
 */
export function ProvidersSettingsSection({
  settings,
  disabled,
  onSettingsChange,
  focusProviderId = null,
}: ProvidersSettingsSectionProps) {
  const options = useSystemExecutionOptions({});
  const fleetDefault = useFleetDefault();
  const providers = options.data?.providers ?? [];
  const defaultProviderId =
    fleetDefault.data?.kind === "stored" ? fleetDefault.data.providerId : null;

  return (
    <SettingsSection
      title="Coding harnesses"
      description="Every harness this instance knows, what it can do, and how bb uses it."
    >
      {options.isPending ? (
        <p className="text-sm text-muted-foreground">Asking the instance…</p>
      ) : options.isError ? (
        <p className="text-sm text-muted-foreground">
          The instance would not list its harnesses, so this cannot be shown.
        </p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The instance listed no harnesses at all.
        </p>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => {
            const toggles = PROVIDER_TOGGLES[provider.id] ?? [];
            const capabilities = Object.entries(CAPABILITY_LABELS)
              .filter(
                ([key]) =>
                  (provider.capabilities as Record<string, unknown>)[key] ===
                  true,
              )
              .map(([, label]) => label);
            return (
              <div
                key={provider.id}
                id={`provider-${provider.id}`}
                data-testid={`provider-${provider.id}`}
                className={cn(
                  "space-y-4 rounded-lg border p-5",
                  focusProviderId === provider.id
                    ? "border-tower-accent"
                    : "border-border",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {provider.displayName}
                  </span>
                  <Pill variant="outline" className="text-muted-foreground">
                    {provider.available ? "available" : "unavailable"}
                  </Pill>
                  {defaultProviderId === provider.id ? (
                    <Pill variant="outline" className="text-muted-foreground">
                      default for new agents
                    </Pill>
                  ) : null}
                </div>

                {toggles.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    This harness has no bb settings of its own — how it launches
                    is part of the harness, not something bb stores.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {toggles.map((toggle) => {
                      const stored = settings[toggle.key] === true;
                      const checked = toggle.inverted ? !stored : stored;
                      return (
                        <SettingsWithControl
                          key={toggle.key}
                          label={toggle.label}
                          description={toggle.description}
                        >
                          <Switch
                            aria-label={`${provider.displayName} — ${toggle.label}`}
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={(next) =>
                              onSettingsChange({
                                ...settings,
                                [toggle.key]: toggle.inverted ? !next : next,
                              })
                            }
                          />
                        </SettingsWithControl>
                      );
                    })}
                  </div>
                )}

                {/* Rendered whether or not anything is true. A line that
                    disappears when a harness reports nothing is
                    indistinguishable from a harness that can do nothing. */}
                <p className="text-xs text-muted-foreground">
                  {provider.capabilities === undefined
                    ? "This harness did not report what it can do."
                    : capabilities.length > 0
                      ? `Can: ${capabilities.join(", ")}. These are facts about the harness, not settings.`
                      : "This harness reports none of the optional capabilities."}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}

export default ProvidersSettingsSection;
