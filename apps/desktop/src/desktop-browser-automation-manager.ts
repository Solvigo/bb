import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  bbDesktopAutomationClickRequestSchema,
  bbDesktopAutomationEvalRequestSchema,
  bbDesktopAutomationNavigateRequestSchema,
  bbDesktopAutomationRegisterTargetRequestSchema,
  bbDesktopAutomationTargetRefSchema,
  bbDesktopAutomationTypeRequestSchema,
  bbDesktopAutomationUnregisterTargetRequestSchema,
  type BbDesktopAutomationSnapshotResult,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_AUTOMATION_CLICK_CHANNEL,
  BB_DESKTOP_AUTOMATION_CLOSE_CHANNEL,
  BB_DESKTOP_AUTOMATION_EVAL_CHANNEL,
  BB_DESKTOP_AUTOMATION_NAVIGATE_CHANNEL,
  BB_DESKTOP_AUTOMATION_REGISTER_TARGET_CHANNEL,
  BB_DESKTOP_AUTOMATION_SNAPSHOT_CHANNEL,
  BB_DESKTOP_AUTOMATION_STOP_CHANNEL,
  BB_DESKTOP_AUTOMATION_TYPE_CHANNEL,
  BB_DESKTOP_AUTOMATION_UNREGISTER_TARGET_CHANNEL,
} from "./desktop-browser-automation-ipc.js";
import {
  automationClick,
  automationEval,
  automationNavigate,
  automationSnapshot,
  automationStop,
  automationType,
  DesktopBrowserAutomationDeniedError,
} from "./desktop-browser-automation.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";

interface AutomationTargetEntry {
  hostWebContentsId: number;
  tabId: string;
}

export interface DesktopBrowserAutomationManager {
  registerTarget(args: {
    hostWindow: BrowserWindow;
    request: {
      targetId: string;
      tabId: string;
      threadId: string;
    };
  }): void;
  unregisterTarget(targetId: string): void;
  navigate(targetId: string, url: string): Promise<void>;
  snapshot(targetId: string): Promise<BbDesktopAutomationSnapshotResult>;
  click(
    request: Parameters<typeof automationClick>[1] & { targetId: string },
  ): Promise<void>;
  type(request: Parameters<typeof automationType>[1]): Promise<void>;
  eval(targetId: string, script: string): Promise<unknown>;
  close(targetId: string): void;
  stop(targetId: string): Promise<void>;
}

function hostWindowFromInvoke(
  event: IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function createDesktopBrowserAutomationManager(
  browserManager: DesktopBrowserViewManager,
): DesktopBrowserAutomationManager {
  const targetsById = new Map<string, AutomationTargetEntry>();

  function requireAutomationWebContents(targetId: string) {
    const target = targetsById.get(targetId);
    if (target === undefined) {
      throw new DesktopBrowserAutomationDeniedError(
        `Automation target ${targetId} is not registered`,
      );
    }
    const hostWindow = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === target.hostWebContentsId,
    );
    if (hostWindow === undefined || hostWindow.isDestroyed()) {
      throw new DesktopBrowserAutomationDeniedError(
        `Automation host window for ${targetId} is unavailable`,
      );
    }
    const webContents = browserManager.getTabWebContents({
      hostWindow,
      tabId: target.tabId,
    });
    if (webContents === null) {
      throw new DesktopBrowserAutomationDeniedError(
        `Automation tab for target ${targetId} is unavailable`,
      );
    }
    return { hostWindow, webContents };
  }

  return {
    registerTarget({ hostWindow, request }) {
      targetsById.set(request.targetId, {
        hostWebContentsId: hostWindow.webContents.id,
        tabId: request.tabId,
      });
    },
    unregisterTarget(targetId) {
      targetsById.delete(targetId);
    },
    async navigate(targetId, url) {
      const { webContents } = requireAutomationWebContents(targetId);
      await automationNavigate(webContents, url);
    },
    async snapshot(targetId) {
      const { webContents } = requireAutomationWebContents(targetId);
      return automationSnapshot(webContents);
    },
    async click(request) {
      const { webContents } = requireAutomationWebContents(request.targetId);
      await automationClick(webContents, request);
    },
    async type(request) {
      const { webContents } = requireAutomationWebContents(request.targetId);
      await automationType(webContents, request);
    },
    async eval(targetId, script) {
      const { webContents } = requireAutomationWebContents(targetId);
      return automationEval(webContents, script);
    },
    close(targetId) {
      const target = targetsById.get(targetId);
      if (target === undefined) {
        return;
      }
      const hostWindow = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.id === target.hostWebContentsId,
      );
      if (hostWindow !== undefined && !hostWindow.isDestroyed()) {
        browserManager.detach({ hostWindow, tabId: target.tabId });
      }
      targetsById.delete(targetId);
    },
    async stop(targetId) {
      const { webContents } = requireAutomationWebContents(targetId);
      await automationStop(webContents);
    },
  };
}

export function registerDesktopBrowserAutomationIpc(
  automation: DesktopBrowserAutomationManager,
): void {
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_REGISTER_TARGET_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromInvoke(event);
      const parsed = bbDesktopAutomationRegisterTargetRequestSchema.safeParse(
        payload,
      );
      if (hostWindow === null || !parsed.success) {
        return;
      }
      automation.registerTarget({ hostWindow, request: parsed.data });
    },
  );
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_UNREGISTER_TARGET_CHANNEL,
    (_event, payload: unknown) => {
      const parsed =
        bbDesktopAutomationUnregisterTargetRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      automation.unregisterTarget(parsed.data.targetId);
    },
  );
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_NAVIGATE_CHANNEL,
    async (_event, payload: unknown) => {
      const parsed = bbDesktopAutomationNavigateRequestSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("invalid automation navigate payload");
      }
      await automation.navigate(parsed.data.targetId, parsed.data.url);
    },
  );
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_SNAPSHOT_CHANNEL,
    async (_event, payload: unknown) => {
      const parsed = bbDesktopAutomationTargetRefSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("invalid automation snapshot payload");
      }
      return automation.snapshot(parsed.data.targetId);
    },
  );
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_CLICK_CHANNEL,
    async (_event, payload: unknown) => {
      const parsed = bbDesktopAutomationClickRequestSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("invalid automation click payload");
      }
      await automation.click(parsed.data);
    },
  );
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_TYPE_CHANNEL,
    async (_event, payload: unknown) => {
      const parsed = bbDesktopAutomationTypeRequestSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("invalid automation type payload");
      }
      await automation.type(parsed.data);
    },
  );
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_EVAL_CHANNEL,
    async (_event, payload: unknown) => {
      const parsed = bbDesktopAutomationEvalRequestSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("invalid automation eval payload");
      }
      return automation.eval(parsed.data.targetId, parsed.data.script);
    },
  );
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_CLOSE_CHANNEL,
    (_event, payload: unknown) => {
      const parsed = bbDesktopAutomationTargetRefSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      automation.close(parsed.data.targetId);
    },
  );
  ipcMain.handle(
    BB_DESKTOP_AUTOMATION_STOP_CHANNEL,
    async (_event, payload: unknown) => {
      const parsed = bbDesktopAutomationTargetRefSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("invalid automation stop payload");
      }
      await automation.stop(parsed.data.targetId);
    },
  );
}
