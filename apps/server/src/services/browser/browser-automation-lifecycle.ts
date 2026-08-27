import { randomUUID } from "node:crypto";
import type {
  BrowserAutomationAuditEntry,
  BrowserCloseResult,
  BrowserClickRequest,
  BrowserCreatedByValue,
  BrowserEvalRequest,
  BrowserEvalResult,
  BrowserListResponse,
  BrowserNavigateRequest,
  BrowserOpenRequest,
  BrowserSnapshot,
  BrowserTarget,
  BrowserTargetRefRequest,
  BrowserTypeRequest,
} from "@bb/server-contract";
import {
  BB_CALLER_THREAD_ID_HEADER,
  BROWSER_VERB,
  CREATED_BY,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps, ServerLogger } from "../../types.js";
import { requirePublicThread } from "../lib/entity-lookup.js";
import { recordBrowserAutomationAudit } from "./browser-automation-audit.js";
import {
  DesktopAutomationChannelCoordinator,
  DesktopAutomationChannelUnavailableError,
  DesktopAutomationCommandError,
} from "./desktop-automation-channel.js";

interface BrowserAutomationLifecycleDeps {
  channel: DesktopAutomationChannelCoordinator;
  db: AppDeps["db"];
  logger: ServerLogger;
}

interface BrowserCallerContext {
  callerThreadId: string | undefined;
  explicitThreadId: string | undefined;
}

interface ResolveTargetThreadIdArgs {
  caller: BrowserCallerContext;
  required: boolean;
}

interface AuthorizeTargetAccessArgs {
  caller: BrowserCallerContext;
  createdBy: BrowserCreatedByValue;
  target: BrowserTarget;
}

export class BrowserAutomationLifecycle {
  private readonly targetsById = new Map<string, BrowserTarget>();

  constructor(private readonly deps: BrowserAutomationLifecycleDeps) {}

  open(args: {
    caller: BrowserCallerContext;
    payload: BrowserOpenRequest;
  }): Promise<BrowserTarget> {
    const threadId = this.requireTargetThreadId({ caller: args.caller });
    const createdBy = deriveCreatedBy(args.caller);
    requirePublicThread(this.deps.db, threadId);
    this.audit({
      verb: BROWSER_VERB.open,
      targetId: null,
      threadId,
      createdBy,
      callerThreadId: args.caller.callerThreadId ?? null,
      visible: args.payload.visible ?? null,
    });
    return this.forwardAndRegisterTarget({
      createdBy,
      threadId,
      verb: BROWSER_VERB.open,
      payload: {
        url: args.payload.url,
        visible: args.payload.visible ?? false,
      },
    });
  }

  list(args: { caller: BrowserCallerContext }): BrowserListResponse {
    const threadId = this.resolveTargetThreadId({
      caller: args.caller,
      required: false,
    });
    const createdBy = deriveCreatedBy(args.caller);
    this.audit({
      verb: BROWSER_VERB.list,
      targetId: null,
      threadId: threadId ?? null,
      createdBy,
      callerThreadId: args.caller.callerThreadId ?? null,
      visible: null,
    });
    const targets = [...this.targetsById.values()].filter((target) =>
      threadId === undefined ? true : target.threadId === threadId,
    );
    return { targets };
  }

  navigate(args: {
    caller: BrowserCallerContext;
    payload: BrowserNavigateRequest;
  }): Promise<BrowserTarget> {
    const target = this.requireAuthorizedTarget({
      caller: args.caller,
      targetId: args.payload.targetId,
    });
    this.audit({
      verb: BROWSER_VERB.navigate,
      targetId: target.targetId,
      threadId: target.threadId,
      createdBy: deriveCreatedBy(args.caller),
      callerThreadId: args.caller.callerThreadId ?? null,
      visible: target.visible,
    });
    return this.forwardTargetMutation({
      target,
      verb: BROWSER_VERB.navigate,
      payload: { url: args.payload.url },
    });
  }

  snapshot(args: {
    caller: BrowserCallerContext;
    payload: BrowserTargetRefRequest;
  }): Promise<BrowserSnapshot> {
    const target = this.requireAuthorizedTarget({
      caller: args.caller,
      targetId: args.payload.targetId,
    });
    this.audit({
      verb: BROWSER_VERB.snapshot,
      targetId: target.targetId,
      threadId: target.threadId,
      createdBy: deriveCreatedBy(args.caller),
      callerThreadId: args.caller.callerThreadId ?? null,
      visible: target.visible,
    });
    return this.forwardSnapshot(target);
  }

  click(args: {
    caller: BrowserCallerContext;
    payload: BrowserClickRequest;
  }): Promise<BrowserTarget> {
    const target = this.requireAuthorizedTarget({
      caller: args.caller,
      targetId: args.payload.targetId,
    });
    this.audit({
      verb: BROWSER_VERB.click,
      targetId: target.targetId,
      threadId: target.threadId,
      createdBy: deriveCreatedBy(args.caller),
      callerThreadId: args.caller.callerThreadId ?? null,
      visible: target.visible,
    });
    return this.forwardTargetMutation({
      target,
      verb: BROWSER_VERB.click,
      payload: args.payload,
    });
  }

  type(args: {
    caller: BrowserCallerContext;
    payload: BrowserTypeRequest;
  }): Promise<BrowserTarget> {
    const target = this.requireAuthorizedTarget({
      caller: args.caller,
      targetId: args.payload.targetId,
    });
    this.audit({
      verb: BROWSER_VERB.type,
      targetId: target.targetId,
      threadId: target.threadId,
      createdBy: deriveCreatedBy(args.caller),
      callerThreadId: args.caller.callerThreadId ?? null,
      visible: target.visible,
    });
    return this.forwardTargetMutation({
      target,
      verb: BROWSER_VERB.type,
      payload: args.payload,
    });
  }

  eval(args: {
    caller: BrowserCallerContext;
    payload: BrowserEvalRequest;
  }): Promise<BrowserEvalResult> {
    const target = this.requireAuthorizedTarget({
      caller: args.caller,
      targetId: args.payload.targetId,
    });
    this.audit({
      verb: BROWSER_VERB.eval,
      targetId: target.targetId,
      threadId: target.threadId,
      createdBy: deriveCreatedBy(args.caller),
      callerThreadId: args.caller.callerThreadId ?? null,
      visible: target.visible,
    });
    return this.forwardEval(target, args.payload.script);
  }

  close(args: {
    caller: BrowserCallerContext;
    payload: BrowserTargetRefRequest;
  }): Promise<BrowserCloseResult> {
    const target = this.targetsById.get(args.payload.targetId);
    if (target === undefined) {
      return Promise.resolve({ closed: false, target: null });
    }
    this.authorizeTargetAccess({
      caller: args.caller,
      createdBy: deriveCreatedBy(args.caller),
      target,
    });
    this.audit({
      verb: BROWSER_VERB.close,
      targetId: target.targetId,
      threadId: target.threadId,
      createdBy: deriveCreatedBy(args.caller),
      callerThreadId: args.caller.callerThreadId ?? null,
      visible: target.visible,
    });
    return this.forwardClose(target);
  }

  /** Test hook: seed registry state without a live desktop channel. */
  registerTargetForTest(target: BrowserTarget): void {
    this.targetsById.set(target.targetId, target);
  }

  private requireTargetThreadId(
    args: Omit<ResolveTargetThreadIdArgs, "required">,
  ): string {
    const threadId = this.resolveTargetThreadId({
      caller: args.caller,
      required: true,
    });
    return threadId as string;
  }

  private resolveTargetThreadId(args: ResolveTargetThreadIdArgs): string | undefined {
    const threadId =
      args.caller.explicitThreadId ?? args.caller.callerThreadId ?? undefined;
    if (args.required && threadId === undefined) {
      throw new ApiError(
        400,
        "invalid_request",
        "Browser commands need a thread: pass ?thread=<id> or send x-bb-thread-id",
      );
    }
    return threadId;
  }

  private requireAuthorizedTarget(args: {
    caller: BrowserCallerContext;
    targetId: string;
  }): BrowserTarget {
    const target = this.targetsById.get(args.targetId);
    if (target === undefined) {
      throw new ApiError(
        404,
        "browser_target_not_found",
        `Browser automation target ${args.targetId} was not found`,
        false,
      );
    }
    this.authorizeTargetAccess({
      caller: args.caller,
      createdBy: deriveCreatedBy(args.caller),
      target,
    });
    return target;
  }

  private authorizeTargetAccess(args: AuthorizeTargetAccessArgs): void {
    if (args.createdBy === CREATED_BY.cli) {
      return;
    }
    const callerThreadId = args.caller.callerThreadId;
    if (callerThreadId === undefined || callerThreadId !== args.target.threadId) {
      throw new ApiError(
        403,
        "browser_target_forbidden",
        `Thread ${callerThreadId ?? "(none)"} cannot drive target ${args.target.targetId} owned by thread ${args.target.threadId}`,
        false,
      );
    }
  }

  private audit(entry: BrowserAutomationAuditEntry): void {
    recordBrowserAutomationAudit(this.deps.logger, { entry });
  }

  private async forwardAndRegisterTarget(args: {
    createdBy: BrowserCreatedByValue;
    payload: { url: string; visible: boolean };
    threadId: string;
    verb: typeof BROWSER_VERB.open;
  }): Promise<BrowserTarget> {
    const now = new Date().toISOString();
    const target: BrowserTarget = {
      targetId: `tgt_${randomUUID()}`,
      threadId: args.threadId,
      createdBy: args.createdBy,
      visible: args.payload.visible,
      createdAt: now,
      lastUsedAt: now,
    };
    await this.deps.channel.forwardCommand({
      verb: args.verb,
      threadId: args.threadId,
      targetId: target.targetId,
      payload: {
        ...args.payload,
        targetId: target.targetId,
      },
    });
    this.targetsById.set(target.targetId, target);
    return target;
  }

  private async forwardTargetMutation(args: {
    payload: Record<string, unknown>;
    target: BrowserTarget;
    verb:
      | typeof BROWSER_VERB.navigate
      | typeof BROWSER_VERB.click
      | typeof BROWSER_VERB.type;
  }): Promise<BrowserTarget> {
    await this.deps.channel.forwardCommand({
      verb: args.verb,
      threadId: args.target.threadId,
      targetId: args.target.targetId,
      payload: args.payload,
    });
    const updated: BrowserTarget = {
      ...args.target,
      lastUsedAt: new Date().toISOString(),
    };
    this.targetsById.set(updated.targetId, updated);
    return updated;
  }

  private async forwardSnapshot(target: BrowserTarget): Promise<BrowserSnapshot> {
    const snapshot = await this.deps.channel.forwardSnapshot({
      targetId: target.targetId,
      threadId: target.threadId,
    });
    const updated: BrowserTarget = {
      ...target,
      lastUsedAt: new Date().toISOString(),
    };
    this.targetsById.set(updated.targetId, updated);
    return {
      target: updated,
      url: snapshot.url,
      title: snapshot.title,
      text: snapshot.text,
    };
  }

  private async forwardEval(
    target: BrowserTarget,
    script: string,
  ): Promise<BrowserEvalResult> {
    const result = await this.deps.channel.forwardEval({
      script,
      targetId: target.targetId,
      threadId: target.threadId,
    });
    const updated: BrowserTarget = {
      ...target,
      lastUsedAt: new Date().toISOString(),
    };
    this.targetsById.set(updated.targetId, updated);
    return { target: updated, result };
  }

  private async forwardClose(target: BrowserTarget): Promise<BrowserCloseResult> {
    await this.deps.channel.forwardCommand({
      verb: BROWSER_VERB.close,
      threadId: target.threadId,
      targetId: target.targetId,
      payload: {},
    });
    this.targetsById.delete(target.targetId);
    return { closed: true, target };
  }
}

export function deriveCreatedBy(
  caller: BrowserCallerContext,
): BrowserCreatedByValue {
  if (caller.explicitThreadId !== undefined) {
    return CREATED_BY.cli;
  }
  if (caller.callerThreadId !== undefined) {
    return CREATED_BY.agent;
  }
  return CREATED_BY.cli;
}

export function readBrowserCallerContext(context: {
  req: { header(name: string): string | undefined; query(key: string): string | undefined };
}): BrowserCallerContext {
  const callerHeader = context.req.header(BB_CALLER_THREAD_ID_HEADER)?.trim();
  const explicitThread = context.req.query("thread")?.trim();
  return {
    callerThreadId: callerHeader && callerHeader.length > 0 ? callerHeader : undefined,
    explicitThreadId:
      explicitThread && explicitThread.length > 0 ? explicitThread : undefined,
  };
}

export function mapDesktopAutomationChannelError(error: unknown): ApiError {
  if (error instanceof DesktopAutomationChannelUnavailableError) {
    return new ApiError(
      503,
      "desktop_automation_channel_unavailable",
      error.message,
      { retryable: true, details: error.details },
    );
  }
  if (error instanceof DesktopAutomationCommandError) {
    return new ApiError(502, error.code, error.message, { retryable: false });
  }
  throw error;
}
