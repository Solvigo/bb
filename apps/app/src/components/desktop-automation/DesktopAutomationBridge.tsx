import { useEffect, useSyncExternalStore } from "react";
import { connectDesktopAutomationChannel } from "@/lib/desktop-automation-channel";
import { getDesktopAutomationApi } from "@/lib/bb-desktop";
import type { OpenSecondaryPanelTabRequest } from "@/components/secondary-panel/useThreadFileTabs";

export interface DesktopAutomationThreadHandlers {
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenTab: (request: OpenSecondaryPanelTabRequest) => string | null;
}

interface RegisteredThreadHandlers extends DesktopAutomationThreadHandlers {
  threadId: string;
}

const targetsById = new Map<string, { tabId: string; threadId: string }>();
const handlersByThreadId = new Map<string, DesktopAutomationThreadHandlers>();
const automationTargetListeners = new Set<() => void>();

function notifyAutomationTargets(): void {
  for (const listener of automationTargetListeners) {
    listener();
  }
}

export function registerDesktopAutomationThreadHandlers(
  handlers: RegisteredThreadHandlers,
): () => void {
  handlersByThreadId.set(handlers.threadId, handlers);
  return () => {
    const current = handlersByThreadId.get(handlers.threadId);
    if (current === handlers) {
      handlersByThreadId.delete(handlers.threadId);
    }
  };
}

export function useAutomationControlledTabIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      automationTargetListeners.add(listener);
      return () => {
        automationTargetListeners.delete(listener);
      };
    },
    () => new Set([...targetsById.values()].map((entry) => entry.tabId)),
    () => new Set<string>(),
  );
}

export function resolveAutomationTargetIdForTab(
  tabId: string,
): string | null {
  for (const [targetId, entry] of targetsById.entries()) {
    if (entry.tabId === tabId) {
      return targetId;
    }
  }
  return null;
}

export function notifyAutomationTabClosedByUser(tabId: string): void {
  const automation = getDesktopAutomationApi();
  for (const [targetId, entry] of targetsById.entries()) {
    if (entry.tabId !== tabId) {
      continue;
    }
    targetsById.delete(targetId);
    void automation?.unregisterTarget({ targetId });
  }
  notifyAutomationTargets();
}

export async function stopAutomationTarget(targetId: string): Promise<void> {
  const automation = getDesktopAutomationApi();
  if (automation !== null) {
    await automation.stop(targetId);
  }
}

export function DesktopAutomationBridge(): null {
  useEffect(() => {
    if (getDesktopAutomationApi() === null) {
      return;
    }
    return connectDesktopAutomationChannel({
      onOpenTab: async ({ targetId, threadId, url, visible }) => {
        const handlers = handlersByThreadId.get(threadId);
        if (handlers === undefined) {
          throw new Error(
            `No desktop view is registered for automation thread ${threadId}`,
          );
        }
        const tabId = handlers.onOpenTab({ kind: "browser", url });
        if (tabId === null) {
          throw new Error("Could not open automation browser tab");
        }
        targetsById.set(targetId, { tabId, threadId });
        notifyAutomationTargets();
        if (visible) {
          handlers.onActivateTab(tabId);
        }
        return { tabId };
      },
      onCloseTab: ({ tabId, targetId }) => {
        const entry = targetsById.get(targetId);
        targetsById.delete(targetId);
        notifyAutomationTargets();
        const handlers =
          entry === undefined ? undefined : handlersByThreadId.get(entry.threadId);
        handlers?.onCloseTab(tabId);
      },
      resolveTabId: (targetId) => targetsById.get(targetId)?.tabId ?? null,
      onStopTarget: async ({ targetId }) => {
        await stopAutomationTarget(targetId);
      },
    });
  }, []);
  return null;
}
