import { Component, type ReactNode } from "react";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import { ageLabel, useCrewRpc } from "./useCrewRpc";

const MONO_LABEL =
  "font-tower-mono text-[9px] font-bold uppercase tracking-[0.12em] text-tower-fg-dim";

interface BoardReport {
  rank: string;
  state: string;
  escalated: boolean;
  note: string;
  at: string;
}
interface QueueItem {
  taskId: string;
  title: string;
  intent: string | null;
  state: string;
  displayState: string | null;
}
interface QueueResult {
  ok: boolean;
  items: QueueItem[];
}
interface WorkAttempt {
  threadId: string;
}
interface WorkItem {
  taskId: string;
  attempts: WorkAttempt[];
}
interface WorkBoardResult {
  ok: boolean;
  workItems: WorkItem[];
}

const STATE_TONE: Record<string, string> = {
  in_flight: "text-tower-accent-hover",
  in_review: "text-tower-fg-muted",
  accepted: "text-tower-fg-dim",
  queued: "text-tower-fg-dim",
  drafted: "text-tower-fg-faint",
};

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
          This SP&apos;s chat needs a connected thread.
        </div>
      );
    }
    return this.props.children;
  }
}

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
  // The SP's OWN ordered board ("lead's order") — the work dispatched to THIS
  // thread, not the global queue. Join the work board (per-thread ownership) to
  // the queue (titles/state).
  const work = useCrewRpc<WorkBoardResult>("crew", "crew_work_board");
  const queue = useCrewRpc<QueueResult>("crew", "crew_queue");
  const ownedTaskIds = new Set(
    (work.data?.workItems ?? [])
      .filter((w) => w.attempts.some((a) => a.threadId === threadId))
      .map((w) => w.taskId),
  );
  const items = (queue.data?.items ?? []).filter((it) =>
    ownedTaskIds.has(it.taskId),
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-surface font-tower-sans">
      {/* SP header */}
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

      {/* split: SP chat left, SP-focused board right */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,44%)_1fr]">
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

        <div className="min-h-0 overflow-y-auto p-3">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <span className={MONO_LABEL}>{label} board · lead&apos;s order</span>
            <span className="font-tower-mono text-[10px] text-tower-fg-faint">
              {queue.error ? "rpc error" : `live · as of ${ageLabel(queue.ageSeconds)}`}
            </span>
          </div>
          {items.length === 0 ? (
            <div className="px-1 py-4 italic text-tower-fg-faint">
              no ordered work yet
            </div>
          ) : (
            <ol className="space-y-2">
              {items.map((it, idx) => (
                <li
                  key={it.taskId}
                  className="flex gap-3 rounded-[10px] bg-tower-panel px-3.5 py-3"
                >
                  <span className="font-tower-mono text-[13px] font-bold text-tower-fg-dim">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={
                          "font-tower-mono text-[9px] font-bold uppercase tracking-wide " +
                          (STATE_TONE[it.displayState ?? it.state] ??
                            "text-tower-fg-dim")
                        }
                      >
                        {(it.displayState ?? it.state).replace(/_/g, " ")}
                      </span>
                      <span className="font-tower-mono text-[10px] text-tower-fg-faint">
                        {it.taskId}
                      </span>
                    </div>
                    <div className="mt-1 text-[13px] font-medium text-tower-fg">
                      {it.title}
                    </div>
                    {it.intent ? (
                      <div className="mt-0.5 text-[12px] leading-snug text-tower-fg-muted">
                        {it.intent}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

export default SpFocusView;
