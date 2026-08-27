import { randomUUID } from "node:crypto";
import type {
  BrowserVerb,
  DesktopAutomationChannelUnavailableDetails,
  DesktopAutomationSnapshotResult,
} from "@bb/server-contract";
import {
  BROWSER_VERB,
  desktopAutomationResponseMessageSchema,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";

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
  constructor(connectedClientCount: number) {
    super(
      `Timed out waiting for desktop automation response (${connectedClientCount} desktop client(s) connected; the one dispatched to never replied — it may be a stale connection left over from a previous app instance)`,
    );
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
const noopLogger: ServerLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

export class DesktopAutomationChannelCoordinator {
  private readonly logger: ServerLogger;
  // Ordered most-recently-registered first. A desktop app relaunch (rebuild,
  // crash recovery, manual restart) opens a new socket without necessarily
  // closing the old one promptly server-side (an abrupt process kill can
  // leave the previous connection looking open until a TCP-level timeout).
  // Dispatching to the newest registration means a relaunch self-heals
  // instead of every command routing to a dead leftover connection forever.
  private clients: DesktopAutomationChannelSocket[] = [];
  private readonly pendingByRequestId = new Map<string, PendingCommand>();

  constructor(deps: { logger?: ServerLogger } = {}) {
    this.logger = deps.logger ?? noopLogger;
  }

  registerClient(socket: DesktopAutomationChannelSocket): void {
    this.clients = [socket, ...this.clients.filter((s) => s !== socket)];
  }

  unregisterClient(socket: DesktopAutomationChannelSocket): void {
    this.clients = this.clients.filter((s) => s !== socket);
    if (this.clients.length === 0) {
      for (const [requestId, pending] of this.pendingByRequestId) {
        clearTimeout(pending.timeout);
        pending.reject(new DesktopAutomationChannelUnavailableError());
        this.pendingByRequestId.delete(requestId);
      }
    }
  }

  hasConnectedChannel(): boolean {
    return this.clients.length > 0;
  }

  handleClientMessage(raw: unknown): void {
    const parsed = desktopAutomationResponseMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return;
    }
    if (parsed.data.ok) {
      this.resolvePending(parsed.data.requestId, parsed.data.result);
      return;
    }
    this.rejectPending(
      parsed.data.requestId,
      new DesktopAutomationCommandError(
        parsed.data.error.code,
        parsed.data.error.message,
      ),
    );
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
    const socket = this.preferredClient();
    if (socket === undefined) {
      return;
    }
    socket.send(JSON.stringify({ type: "cancel", requestId }));
    this.rejectPending(requestId, new DesktopAutomationCommandCancelledError());
  }

  /** The most-recently-registered connected client, or undefined if none. */
  private preferredClient(): DesktopAutomationChannelSocket | undefined {
    return this.clients[0];
  }

  private dispatch(args: {
    payload: Record<string, unknown>;
    targetId?: string;
    threadId: string;
    verb: BrowserVerb;
  }): Promise<unknown> {
    const socket = this.preferredClient();
    if (socket === undefined) {
      return Promise.reject(new DesktopAutomationChannelUnavailableError());
    }
    const requestId = randomUUID();
    const connectedClientCount = this.clients.length;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingByRequestId.delete(requestId);
        this.logger.warn(
          {
            requestId,
            verb: args.verb,
            threadId: args.threadId,
            targetId: args.targetId ?? null,
            connectedClientCount,
          },
          "desktop automation command timed out waiting for a client response",
        );
        reject(new DesktopAutomationCommandTimeoutError(connectedClientCount));
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
