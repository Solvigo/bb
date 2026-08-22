import { Component, type ReactNode, useState } from "react";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import "./tower-shell.css";
import {
  CLEARANCE,
  LANES,
  PILOT,
  QUEUE,
  type ClearanceItem,
  type Lane,
  type WorkItem,
} from "./fixtures";

type Tab = "overview" | "clearance";

/** The commander thread the left column pilots. Fixture id — no fleet read. */
const COMMANDER_THREAD_ID = "thr_commander";
const COMMANDER_PROJECT_ID = "proj-tower";
const COMMANDER_PROVIDER_ID = "provider-tower";

const STATE_LABEL: Record<WorkItem["state"], string> = {
  queued: "queued",
  in_flight: "in flight",
  in_review: "in review",
  accepted: "accepted",
  dropped: "dropped",
};

function ago(min: number): string {
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

function isStale(lane: Lane): boolean {
  // A status line older than the lane's last activity cannot be trusted.
  return lane.statusAgeMin > lane.lastActivityMin;
}

function laneNeedsAttention(lane: Lane): boolean {
  return CLEARANCE.some((c) => c.fromLane === lane.id);
}

/**
 * The real EmbeddedThreadChat owns backend-backed queries. On the fixture loop
 * (no server) those fail; if any surface throws, we keep the frame intact and
 * say so honestly rather than white-screening the whole shell.
 */
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
        <div className="tower-chat__fallback">
          The commander chat surface needs a connected thread. On the fixture
          loop it mounts without one — wired to a live thread in Phase&nbsp;1.
        </div>
      );
    }
    return this.props.children;
  }
}

function CommanderChat() {
  return (
    <div className="tower-chat">
      <div className="tower-chat__head">
        <div className="tower-chat__avatar">HP</div>
        <div>
          <div className="tower-chat__title">{PILOT.name}</div>
          <div className="tower-chat__sub">{PILOT.domain}</div>
        </div>
      </div>
      <div className="tower-chat__body">
        {/* The chat's timeline rows need router context; the app's root
            BrowserRouter already supplies it, so we mount directly — a nested
            Router is a hard crash in react-router v6. */}
        <ChatBoundary>
          <EmbeddedThreadChat
            variant="compact"
            surfaceTone="sidebar"
            threadId={COMMANDER_THREAD_ID}
            surfaceFallbackKey="tower-commander"
            projectId={COMMANDER_PROJECT_ID}
            providerId={COMMANDER_PROVIDER_ID}
            promptContextEnvironmentId={null}
            resolveMentionLink={() => null}
            composer={{
              draftScope: {
                kind: "thread",
                projectId: COMMANDER_PROJECT_ID,
                threadId: COMMANDER_THREAD_ID,
              },
              executionDefaultsThreadId: COMMANDER_THREAD_ID,
              executionResetKey: COMMANDER_THREAD_ID,
              permissionPolicy: "snapshot",
              environmentSummary: null,
            }}
          />
        </ChatBoundary>
      </div>
    </div>
  );
}

function LaneCard({ lane }: { lane: Lane }) {
  const stale = isStale(lane);
  const attention = laneNeedsAttention(lane);
  const quiet = !attention && lane.lastActivityMin >= 15;
  return (
    <div className="tower-lane">
      <div className="tower-lane__head">
        <span className="tower-lane__mark">{lane.rank}</span>
        <span className="tower-lane__name">{lane.name}</span>
        <span className="tower-lane__domain">{lane.domain}</span>
        <span className="tower-status">
          <span
            className={
              "tower-dot" +
              (attention ? " tower-dot--attention" : quiet ? " tower-dot--quiet" : "")
            }
          />
          {attention ? "needs you" : quiet ? "quiet" : "working"}
        </span>
      </div>

      <div>
        <div className="tower-lane__line">{lane.statusLine}</div>
        <div className={"tower-lane__age" + (stale ? " tower-lane__age--stale" : "")}>
          {stale
            ? `stated ${ago(lane.statusAgeMin)} · stale (active ${ago(lane.lastActivityMin)})`
            : `stated ${ago(lane.statusAgeMin)}`}
        </div>
      </div>

      <div className="tower-fn">
        <span className="tower-fn__k">Focus</span>
        <span className="tower-fn__v">{lane.focus}</span>
        <span className="tower-fn__k">Next</span>
        <span className={"tower-fn__v" + (lane.next ? "" : " tower-fn__v--empty")}>
          {lane.next ?? "nothing queued"}
        </span>
      </div>

      <div className="tower-items">
        {lane.items.length === 0 ? (
          <span className="tower-empty">no work items</span>
        ) : (
          lane.items.map((it) => (
            <span key={it.taskId} className="tower-chip">
              {it.title}{" "}
              <span className="tower-chip__state">· {STATE_LABEL[it.state]}</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Overview() {
  return (
    <div className="tower-overview">
      <p className="tower-overview__intro">
        Every domain SP and what is on its mind, right now. Status lines are
        self-authored and stamped per turn; a line older than the lane's last
        move is marked stale, never trusted.
      </p>
      <div className="tower-lanes">
        {LANES.map((lane) => (
          <LaneCard key={lane.id} lane={lane} />
        ))}
      </div>

      <div className="tower-queue">
        <div className="tower-queue__head">
          <span className="eyebrow">Queue · unowned</span>
        </div>
        {QUEUE.length === 0 ? (
          <span className="tower-queue__empty">empty — nothing unowned</span>
        ) : (
          <div className="tower-items">
            {QUEUE.map((it) => (
              <span key={it.taskId} className="tower-chip">
                {it.title}{" "}
                <span className="tower-chip__state">· {STATE_LABEL[it.state]}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClearanceDetail({ item }: { item: ClearanceItem | null }) {
  if (!item) {
    return (
      <div className="tower-detail__empty">
        Select an item on the left to see what it is and what it needs.
      </div>
    );
  }
  return (
    <div className="tower-clearance__detail">
      <div className="tower-detail__kicker">
        <span className="eyebrow">
          {item.kind} · from {item.fromLane}
        </span>
      </div>
      <h1 className="tower-detail__title">{item.title}</h1>

      <div className="tower-detail__section">
        <div className="tower-detail__k">What was done</div>
        <div className="tower-detail__v">{item.detail.whatWasDone}</div>
      </div>
      <div className="tower-detail__section">
        <div className="tower-detail__k">Result</div>
        <div className="tower-detail__v">{item.detail.result}</div>
      </div>
      {(item.detail.prUrl || item.detail.sealedSha) && (
        <div className="tower-detail__section">
          <div className="tower-detail__k">Deliverable</div>
          <div className="tower-detail__meta">
            PR: {item.detail.prUrl ?? "—"} · sealed sha: {item.detail.sealedSha ?? "—"}
          </div>
        </div>
      )}
      <div className="tower-detail__ask">
        <div className="tower-detail__k">Needs you</div>
        <div className="tower-detail__v">{item.detail.ask}</div>
      </div>
    </div>
  );
}

function Clearance() {
  const [selectedId, setSelectedId] = useState<string | null>(
    CLEARANCE[0]?.id ?? null,
  );
  const selected = CLEARANCE.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="tower-clearance">
      <div className="tower-clearance__list">
        <div className="tower-clearance__listhead">
          <span className="eyebrow">Yours to clear</span>
          <span className="eyebrow">{CLEARANCE.length}</span>
        </div>
        {CLEARANCE.length === 0 ? (
          <div className="tower-empty">Nothing needs you. A clear desk.</div>
        ) : (
          CLEARANCE.map((c) => (
            <button
              key={c.id}
              type="button"
              className={
                "tower-demand" +
                (c.rank === 1 ? " tower-demand--top" : "") +
                (c.id === selectedId ? " tower-demand--selected" : "")
              }
              onClick={() => setSelectedId(c.id)}
            >
              <div className="tower-demand__top">
                <span className="tower-demand__rank">#{c.rank}</span>
                <span className="tower-demand__title">{c.title}</span>
              </div>
              <div className="tower-demand__rationale">{c.rationale}</div>
              <div className="tower-demand__tags">
                <span
                  className={
                    "tower-tag " + (c.vetted ? "tower-tag--vetted" : "tower-tag--unvetted")
                  }
                >
                  {c.vetted ? "vetted" : "unvetted"}
                </span>
                <span className="tower-tag">{c.kind}</span>
              </div>
            </button>
          ))
        )}
      </div>
      <ClearanceDetail item={selected} />
    </div>
  );
}

export function TowerShellView() {
  const [tab, setTab] = useState<Tab>("overview");
  const clearanceCount = CLEARANCE.length;

  return (
    <div className="tower">
      <CommanderChat />
      <div className="tower-surface">
        <div className="tower-surface__bar">
          <button
            type="button"
            className={"tower-tab" + (tab === "overview" ? " tower-tab--active" : "")}
            onClick={() => setTab("overview")}
          >
            Overview
            <span className="tower-tab__count">{LANES.length}</span>
          </button>
          <button
            type="button"
            className={"tower-tab" + (tab === "clearance" ? " tower-tab--active" : "")}
            onClick={() => setTab("clearance")}
          >
            Clearance
            <span
              className={
                "tower-tab__count" +
                (clearanceCount > 0 ? " tower-tab__count--attention" : "")
              }
            >
              {clearanceCount}
            </span>
          </button>
          <span className="tower-surface__meta">TOWER · increment 1 · fixture data</span>
        </div>
        <div className="tower-surface__body">
          {tab === "overview" ? <Overview /> : <Clearance />}
        </div>
      </div>
    </div>
  );
}

export default TowerShellView;
