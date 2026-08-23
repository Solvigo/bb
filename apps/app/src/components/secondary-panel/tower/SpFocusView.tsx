import { Component, type ReactNode } from "react";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import { TowerRenderSurface } from "./TowerRenderSurface";

interface BoardReport {
  rank: string;
  state: string;
  escalated: boolean;
  note: string;
  at: string;
}

function initials(label: string): string {
  const clean = label.replace(/^thr_/, "");
  return clean.slice(0, 2).toUpperCase();
}

/** The SP's chat needs backend queries; keep the frame if they fail (no server). */
class ChatBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="grid h-full place-items-center px-6 text-center italic text-tower-fg-faint">
          This agent&apos;s chat needs a connected thread.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Drilling into an agent = the recursive shell: its chat on the LEFT, its OWN
 * rendering surface (the same tab host) on the RIGHT. So every agent has a place
 * to bring things up, and its Crew tab drills into its own sub-crew — the shell
 * all the way down. The far-left commander chat (outside this) is untouched.
 */
export function SpFocusView({
  threadId,
  label,
  domain,
  report,
  onBack,
}: {
  threadId: string;
  label: string;
  domain: string;
  report: BoardReport | null;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-render font-tower-sans">
      {/* agent header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-tower-border px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-tower-border px-2 py-0.5 font-tower-mono text-[10px] text-tower-fg-dim transition-colors hover:bg-tower-bright hover:text-tower-fg-body"
        >
          ‹ board
        </button>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-tower-bright font-tower-mono text-[10px] font-bold text-tower-fg-muted">
          {initials(label)}
        </span>
        <span className="font-semibold text-tower-fg">{label}</span>
        <span className="font-tower-mono text-[11px] text-tower-fg-faint">
          {domain}
        </span>
        <span className="ml-auto font-tower-mono text-[10px] text-tower-fg-faint">
          {report ? `${report.state} · ${report.at}` : "no report yet"}
        </span>
      </div>

      {/* the recursive shell: agent chat left, its own rendering surface right */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,38%)_1fr]">
        <div className="flex min-h-0 flex-col border-r border-tower-border">
          <ChatBoundary>
            <EmbeddedThreadChat
              variant="compact"
              surfaceTone="background"
              threadId={threadId}
              surfaceFallbackKey={`tower-sp-${threadId}`}
              projectId="proj-tower"
              providerId="provider-tower"
              promptContextEnvironmentId={null}
              resolveMentionLink={() => null}
              composer={{
                draftScope: {
                  kind: "thread",
                  projectId: "proj-tower",
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
        <TowerRenderSurface scopeThreadId={threadId} scopeLabel={label} />
      </div>
    </div>
  );
}

export default SpFocusView;
