import type { DesktopAutomationChannelUnavailableDetails } from "@bb/server-contract";
import type { BrowserVerb } from "@bb/server-contract";

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

interface DesktopAutomationChannelSocket {
  close(code?: number, reason?: string): void;
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

interface ForwardSnapshotResult {
  text: string;
  title: string;
  url: string;
}

export class DesktopAutomationChannelCoordinator {
  private readonly clients = new Set<DesktopAutomationChannelSocket>();

  registerClient(socket: DesktopAutomationChannelSocket): void {
    this.clients.add(socket);
  }

  unregisterClient(socket: DesktopAutomationChannelSocket): void {
    this.clients.delete(socket);
  }

  hasConnectedChannel(): boolean {
    return this.clients.size > 0;
  }

  async forwardCommand(_args: ForwardCommandArgs): Promise<void> {
    this.ensureChannel();
  }

  async forwardSnapshot(_args: ForwardSnapshotArgs): Promise<ForwardSnapshotResult> {
    this.ensureChannel();
    throw new DesktopAutomationChannelUnavailableError();
  }

  async forwardEval(_args: ForwardEvalArgs): Promise<unknown> {
    this.ensureChannel();
    throw new DesktopAutomationChannelUnavailableError();
  }

  private ensureChannel(): void {
    if (!this.hasConnectedChannel()) {
      throw new DesktopAutomationChannelUnavailableError();
    }
  }
}
