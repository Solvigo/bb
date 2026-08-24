import { Icon } from "@bb/shared-ui/icon";
import { SettingsSection } from "@/components/ui/settings-section.js";

/**
 * MCP connections. There is nothing to list yet: this instance exposes no MCP
 * server registry, so the honest surface says what it would hold and what has
 * to exist first, rather than showing an empty table that reads as "you have
 * no servers" when the truth is "nothing here can see them".
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
            <p className="font-medium text-foreground">
              This instance has no MCP registry yet
            </p>
            <p className="leading-relaxed text-muted-foreground">
              Nothing here is hidden or switched off — there is simply no
              record of MCP servers for this screen to read. When there is, it
              will list each server, whether it is reachable, and the tools it
              offers, and let you add and remove them.
            </p>
            <p className="leading-relaxed text-muted-foreground">
              bb does speak MCP internally: it proxies its own tools into an
              agent that way. That is the opposite direction from connecting
              this instance to servers you choose, so it gives this screen
              nothing to show.
            </p>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

export default ConnectionsSettingsSection;
