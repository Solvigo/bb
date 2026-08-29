import { usePluginSlots, type PluginAgentSurfaceTabSlot } from "./plugin-slots";

/**
 * Agent-surface tab id convention a plugin uses to register the in-app
 * streamed browser (e.g. the agent-browser plugin). Any plugin registering
 * this id becomes the fallback browser transport wherever the native desktop
 * browser is absent.
 */
export const STREAMED_BROWSER_TAB_ID = "browser";

/** The registered streamed-browser agent-surface tab, or null if none is. */
export function useStreamedBrowserSurfaceTab(): PluginAgentSurfaceTabSlot | null {
  const { agentSurfaceTabs } = usePluginSlots();
  return (
    agentSurfaceTabs.find((tab) => tab.id === STREAMED_BROWSER_TAB_ID) ?? null
  );
}
