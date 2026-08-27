import type { DbConnection } from "@bb/db";
import type { ServerLogger } from "../../types.js";
import { BrowserAutomationLifecycle } from "./browser-automation-lifecycle.js";
import { DesktopAutomationChannelCoordinator } from "./desktop-automation-channel.js";

export function createBrowserAutomationServices(args: {
  db: DbConnection;
  logger: ServerLogger;
}): {
  browserAutomation: BrowserAutomationLifecycle;
  desktopAutomationChannel: DesktopAutomationChannelCoordinator;
} {
  const desktopAutomationChannel = new DesktopAutomationChannelCoordinator();
  const browserAutomation = new BrowserAutomationLifecycle({
    channel: desktopAutomationChannel,
    db: args.db,
    logger: args.logger,
  });
  return { browserAutomation, desktopAutomationChannel };
}
