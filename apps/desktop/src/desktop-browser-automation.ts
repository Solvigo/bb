import type { WebContents } from "electron";
import type {
  BbDesktopAutomationClickRequest,
  BbDesktopAutomationSnapshotResult,
  BbDesktopAutomationTypeRequest,
} from "@bb/desktop-contract";

export class DesktopBrowserAutomationDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopBrowserAutomationDeniedError";
  }
}

const CDP_VERSION = "1.3";

async function withDebugger<T>(
  webContents: WebContents,
  run: () => Promise<T>,
): Promise<T> {
  const debugger_ = webContents.debugger;
  const wasAttached = debugger_.isAttached();
  if (!wasAttached) {
    debugger_.attach(CDP_VERSION);
  }
  try {
    return await run();
  } finally {
    if (!wasAttached && debugger_.isAttached()) {
      debugger_.detach();
    }
  }
}

export async function automationNavigate(
  webContents: WebContents,
  url: string,
): Promise<void> {
  await withDebugger(webContents, async () => {
    await webContents.debugger.sendCommand("Page.enable");
    await webContents.debugger.sendCommand("Page.navigate", { url });
  });
}

export async function automationSnapshot(
  webContents: WebContents,
): Promise<BbDesktopAutomationSnapshotResult> {
  return withDebugger(webContents, async () => {
    await webContents.debugger.sendCommand("Runtime.enable");
    const evalResult = (await webContents.debugger.sendCommand(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const title = document.title || "";
          const text = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 8000) : "";
          return { title, text };
        })()`,
        returnByValue: true,
      },
    )) as { result?: { value?: { title?: string; text?: string } } };
    const value = evalResult.result?.value ?? {};
    return {
      url: webContents.getURL(),
      title: typeof value.title === "string" ? value.title : "",
      text: typeof value.text === "string" ? value.text : "",
    };
  });
}

async function resolveClickCoordinates(
  webContents: WebContents,
  request: BbDesktopAutomationClickRequest,
): Promise<{ x: number; y: number }> {
  if ("x" in request && "y" in request) {
    return { x: request.x, y: request.y };
  }
  const evalResult = (await webContents.debugger.sendCommand(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(request.selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`,
      returnByValue: true,
    },
  )) as { result?: { value?: { x?: number; y?: number } | null } };
  const coords = evalResult.result?.value;
  if (
    coords === null ||
    coords === undefined ||
    typeof coords.x !== "number" ||
    typeof coords.y !== "number"
  ) {
    throw new DesktopBrowserAutomationDeniedError(
      `Selector did not resolve to clickable coordinates: ${request.selector}`,
    );
  }
  return { x: coords.x, y: coords.y };
}

export async function automationClick(
  webContents: WebContents,
  request: BbDesktopAutomationClickRequest,
): Promise<void> {
  await withDebugger(webContents, async () => {
    const { x, y } = await resolveClickCoordinates(webContents, request);
    await webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  });
}

export async function automationType(
  webContents: WebContents,
  request: BbDesktopAutomationTypeRequest,
): Promise<void> {
  await automationClick(webContents, {
    targetId: request.targetId,
    selector: request.selector,
  });
  await withDebugger(webContents, async () => {
    for (const char of request.text) {
      await webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
        type: "char",
        text: char,
      });
    }
  });
}

export async function automationEval(
  webContents: WebContents,
  script: string,
): Promise<unknown> {
  return withDebugger(webContents, async () => {
    const result = (await webContents.debugger.sendCommand("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    return result.result?.value ?? null;
  });
}

export async function automationStop(webContents: WebContents): Promise<void> {
  if (!webContents.isDestroyed()) {
    webContents.stop();
  }
}
