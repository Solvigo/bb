import type { BrowserAutomationAuditEntry } from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";

export interface RecordBrowserAutomationAuditArgs {
  entry: BrowserAutomationAuditEntry;
}

export function recordBrowserAutomationAudit(
  logger: ServerLogger,
  args: RecordBrowserAutomationAuditArgs,
): void {
  logger.info({ browserAutomation: args.entry }, "browser automation command");
}
