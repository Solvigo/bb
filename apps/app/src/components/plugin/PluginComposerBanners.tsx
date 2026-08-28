import type { ComposerView } from "@bb/plugin-sdk";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  composerScopeIdentity,
  PluginComposerViewProvider,
  useOptionalPluginComposerView,
} from "./plugin-composer-host";
import { composerCustomizationsForScope } from "./composer-customizations";

/** Plugin banner rows rendered above a composer's native measured stack. */
export function PluginComposerBanners({ view }: { view?: ComposerView }) {
  return view === undefined ? (
    <PluginComposerBannerRows />
  ) : (
    <PluginComposerViewProvider value={view}>
      <PluginComposerBannerRows />
    </PluginComposerViewProvider>
  );
}

function PluginComposerBannerRows() {
  const view = useOptionalPluginComposerView();
  const { composerCustomizations } = usePluginSlots();
  if (view === undefined) return null;
  const scopeKey = composerScopeIdentity(view.scope);
  const scopedCustomizations = composerCustomizationsForScope(
    composerCustomizations,
    view.scope.kind,
  );

  // Flattened and sorted ACROSS plugins, not within one: rows arrive grouped by
  // plugin id, which is alphabetical order wearing a disguise — it silently
  // reorders the day a plugin is renamed. A row that states a position gets it;
  // the sort is stable, so rows that state nothing keep the order they had.
  const rows = scopedCustomizations
    .flatMap((customization) =>
      (customization.banners ?? []).map((banner) => ({
        banner,
        customization,
      })),
    )
    .sort(
      (a, b) =>
        (a.banner.experimental_order ?? 0) - (b.banner.experimental_order ?? 0),
    );

  return (
    <>
      {rows.map(({ banner, customization }) => {
        const slotId = `${customization.id}/${banner.id}`;
        return (
          <PluginSlotMount
            key={`${customization.pluginId}/${slotId}/${customization.generation}/${scopeKey}`}
            pluginId={customization.pluginId}
            slotKind="composerBanner"
            slotId={slotId}
            crashFallback={<></>}
          >
            {banner.chrome === "bare" ? (
              <banner.component />
            ) : (
              <PromptStackCard
                ariaLabel={customization.pluginId}
                className="empty:hidden"
              >
                <banner.component />
              </PromptStackCard>
            )}
          </PluginSlotMount>
        );
      })}
    </>
  );
}
