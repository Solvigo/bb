import { randomUUID } from "node:crypto";
import type {
  BrowserVerb,
  DesktopAutomationChannelUnavailableDetails,
  DesktopAutomationSnapshotResult,
} from "@bb/server-contract";
import {
  BROWSER_VERB,
  desktopAutomationErrorResponseMessageSchema,
  desktopAutomationResponseMessageSchema,
} from "@bb/server-contract";

export class DesktopAutomationChannelUnavailableError extends Error {
  readonly details: DesktopAutomationChannelUnavailableDetails = {
    missing: "desktop-automation-channel",
  };

  constructor() {
    super(
      "No desktop automation channel connected — Phase 3 desktop request channel is required to execute browser commands",
    );
    this.name = "DesktopAutomationChannelUnavailableError";
  }
}

export class DesktopAutomationCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DesktopAutomationCommandError";
  }
}

export class DesktopAutomationCommandTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for desktop automation response");
    this.name = "DesktopAutomationCommandTimeoutError";
  }
}

export class DesktopAutomationCommandCancelledError extends Error {
  constructor() {
    super("Desktop automation command was cancelled");
    this.name = "DesktopAutomationCommandCancelledError";
  }
}

interface DesktopAutomationChannelSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface ForwardCommandArgs {
  payload: Record<string, unknown>;
  targetId?: string;
  threadId: string;
  verb: BrowserVerb;
}

interface ForwardSnapshotArgs {
  targetId: string;
  threadId: string;
}

interface ForwardEvalArgs {
  script: string;
  targetId: string;
  threadId: string;
}

interface PendingCommand {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export class DesktopAutomationChannelCoordinator {
  private readonly clients = new Set<DesktopAutomationChannelSocket>();
  private readonly pendingByRequestId = new Map<string, PendingCommand>();

  registerClient(socket: DesktopAutomationChannelSocket): void {
    this.clients.add(socket);
  }

  unregisterClient(socket: DesktopAutomationChannelSocket): void {
    this.clients.delete(socket);
    if (this.clients.size === 0) {
      for (const [requestId, pending] of this.pendingByRequestId) {
        clearTimeout(pending.timeout);
        pending.reject(new DesktopAutomationChannelUnavailableError());
        this.pendingByRequestId.delete(requestId);
      }
    }
  }

  hasConnectedChannel(): boolean {
    return this.clients.size > 0;
  }

  handleClientMessage(raw: unknown): void {
    const responseOk = desktopAutomationResponseMessageSchema.safeParse(raw);
    if (responseOk.success) {
      this.resolvePending(responseOk.data.requestId, responseOk.data.result);
      return;
    }
    const responseErr = desktopAutomationErrorResponseMessageSchema.safeParse(raw);
    if (responseErr.success) {
      this.rejectPending(
        responseErr.data.requestId,
        new DesktopAutomationCommandError(
          responseErr.data.error.code,
          responseErr.data.error.message,
        ),
      );
    }
  }

  async forwardCommand(args: ForwardCommandArgs): Promise<unknown> {
    return this.dispatch({
      payload: args.payload,
      targetId: args.targetId,
      threadId: args.threadId,
      verb: args.verb,
    });
  }

  async forwardSnapshot(
    args: ForwardSnapshotArgs,
  ): Promise<DesktopAutomationSnapshotResult> {
    const result = await this.dispatch({
      payload: { targetId: args.targetId },
      targetId: args.targetId,
      threadId: args.threadId,
      verb: BROWSER_VERB.snapshot,
    });
    return result as DesktopAutomationSnapshotResult;
  }

  async forwardEval(args: ForwardEvalArgs): Promise<unknown> {
    return this.dispatch({
      payload: { script: args.script, targetId: args.targetId },
      targetId: args.targetId,
      threadId: args.threadId,
      verb: BROWSER_VERB.eval,
    });
  }

  cancelRequest(requestId: string): void {
    const socket = this.firstClient();
    if (socket === undefined) {
      return;
    }
    socket.send(JSON.stringify({ type: "cancel", requestId }));
    this.rejectPending(requestId, new DesktopAutomationCommandCancelledError());
  }

  private firstClient(): DesktopAutomationChannelSocket | undefined {
    for (const socket of this.clients) {
      return socket;
    }
    return undefined;
  }

  private dispatch(args: {
    payload: Record<string, unknown>;
    targetId?: string;
    threadId: string;
    verb: BrowserVerb;
  }): Promise<unknown> {
    const socket = this.firstClient();
    if (socket === undefined) {
      return Promise.reject(new DesktopAutomationChannelUnavailableError());
    }
    const requestId = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingByRequestId.delete(requestId);
        reject(new DesktopAutomationCommandTimeoutError());
      }, DEFAULT_COMMAND_TIMEOUT_MS);
      this.pendingByRequestId.set(requestId, { reject, resolve, timeout });
      try {
        socket.send(
          JSON.stringify({
            type: "command",
            requestId,
            verb: args.verb,
            threadId: args.threadId,
            ...(args.targetId !== undefined ? { targetId: args.targetId } : {}),
            payload: args.payload,
          }),
        );
      } catch (error) {
        clearTimeout(timeout);
        this.pendingByRequestId.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private resolvePending(requestId: string, result: unknown): void {
    const pending = this.pendingByRequestId.get(requestId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingByRequestId.delete(requestId);
    pending.resolve(result);
  }

  private rejectPending(requestId: string, error: Error): void {
    const pending = this.pendingByRequestId.get(requestId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingByRequestId.delete(requestId);
    pending.reject(error);
  }
}
