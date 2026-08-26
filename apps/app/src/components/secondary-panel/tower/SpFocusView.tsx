import { Component, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { SecondaryPanelEmptyState } from "../SecondaryPanelEmptyState";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import { TowerRenderSurface } from "./TowerRenderSurface";
import { useLiveThreads } from "./useLiveThreads";
import { SwapAgentButton } from "./SwapAgentButton";
import { ageSince } from "@/lib/relative-time";

interface BoardReport {
  rank: string;
  state: string;
  escalated: boolean;
  note: string;
  at: string;
}

/** The SP's chat needs backend queries; keep the frame if they fail (no server). */
class ChatBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <SecondaryPanelEmptyState
          icon="AlertTriangle"
          title="Chat unavailable"
          description="This agent's chat needs a connected thread."
          role="alert"
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Drilling into a LEAD = the recursive shell: its chat on the LEFT, its OWN
 * rendering surface (the same tab host) on the RIGHT. So every agent has a place
 * to bring things up, and its Crew tab drills into its own workers — the shell
 * all the way down. The far-left commander chat (outside this) is untouched.
 */
export function SpFocusView({
  threadId,
  label,
  report,
  onBack,
}: {
  threadId: string;
  label: string;
  report: BoardReport | null;
  onBack: () => void;
}) {
  // The agent's REAL project and provider. The placeholders these replace made
  // the composer resolve a model that does not exist on the rig — the same
  // defect that killed the first fixture crew.
  const live = useLiveThreads()?.get(threadId);
  const projectId = live?.projectId ?? "";
  const providerId = live?.providerId ?? "";
  const reportAge = ageSince(report?.at);
  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-bg">
      {/* agent header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-tower-border bg-tower-surface px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-tower-border px-2 py-1 text-xs text-tower-fg-dim transition-colors hover:bg-tower-bright hover:text-tower-fg-body"
        >
          ‹ agents
        </button>
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-tower-border bg-tower-input text-tower-fg-muted">
          <Icon name="Code" className="size-4" aria-hidden />
        </span>
        <span className="font-semibold text-tower-fg">{label}</span>
        <span className="text-xs text-tower-fg-faint">Coding agent</span>
        <span
          className="ml-auto text-xs text-tower-fg-faint"
          title={report?.at ?? undefined}
        >
          {report
            ? `${report.state}${reportAge ? ` · ${reportAge} ago` : ""}`
            : "ready"}
        </span>
        {/* The agent's own header is where the thing being swapped is named, so
            it is where the swap belongs. */}
        <SwapAgentButton threadId={threadId} />
      </div>

      {/* the recursive shell: agent chat left, its own rendering surface right */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,26%)_1fr] gap-0">
        <div className="flex min-h-0 flex-col">
          <ChatBoundary>
            <EmbeddedThreadChat
              variant="compact"
              surfaceTone="background"
              threadId={threadId}
              // The operator is reading this lead's thread right now, so its
              // commander does not need waking to be told about it. Without
              // this, every steer of a lead pinged the commander — the parent
              // notify exists for delegated work, not for a conversation the
              // operator is already having.
              turnOrigin="operator-steer"
              surfaceFallbackKey={`tower-sp-${threadId}`}
              projectId={projectId}
              providerId={providerId}
              promptContextEnvironmentId={null}
              resolveMentionLink={() => null}
              composer={{
                draftScope: {
                  kind: "thread",
                  projectId,
                  threadId,
                },
                executionDefaultsThreadId: threadId,
                executionResetKey: threadId,
                permissionPolicy: "snapshot",
                environmentSummary: null,
              }}
            />
          </ChatBoundary>
        </div>
        {/* the lead's own rendering area — the same floating card the
            commander's surface is, so the recursion holds visually too */}
        <div className="min-h-0 p-2 pl-0">
          <div className="h-full min-h-0 overflow-hidden rounded-xl border border-tower-input-border bg-tower-surface">
            <TowerRenderSurface scopeThreadId={threadId} viewerRole="lead" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default SpFocusView;
