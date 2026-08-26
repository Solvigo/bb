import { Icon } from "@bb/shared-ui/icon";
import { SettingsSection } from "@/components/ui/settings-section.js";

/**
 * MCP connections, deliberately not built yet (the Captain's call). The row
 * keeps its place in the platform section so the shape of that section is
 * settled, and this screen says plainly that the feature is coming rather than
 * showing an empty table that would read as "you have no servers" — which is a
 * different and untrue statement.
 */
export function ConnectionsSettingsSection() {
  return (
    <SettingsSection
      title="Connections"
      description="MCP servers this instance can reach."
    >
      <div className="rounded-lg border border-border bg-surface-raised p-5">
        <div className="flex items-start gap-3">
          <Icon
            name="ElectricPlugs"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="space-y-2.5 text-sm">
            <p className="font-medium text-foreground">Coming soon</p>
            <p className="leading-relaxed text-muted-foreground">
              This is where you will connect the instance to MCP servers and see
              which are reachable and what tools each one offers. It is not
              built yet, and nothing is hidden or switched off behind this
              screen — there is simply nothing here to show you.
            </p>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

export default ConnectionsSettingsSection;
