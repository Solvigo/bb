import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { PinnedIconTab } from "../PinnedIconTab";
import { FleetOverviewTab } from "./FleetOverviewTab";
import { ClearanceTab } from "./ClearanceTab";
import { KnowledgeTab } from "./KnowledgeTab";

/**
 * The recursive rendering surface. The top-level shell is a commander chat + a
 * rendering surface with tabs; drilling into an agent gives the SAME shell scoped
 * to that agent — its own chat + its own rendering surface. This is that surface:
 * a tab host (Crew / Clearance / Knowledge) scoped to one agent, so every agent
 * has a place to bring things up, recursively (its Crew tab drills into its own
 * sub-crew, which opens their surfaces again).
 *
 * It wears the SAME chrome as the pilot's own surface — the shared PinnedIconTab
 * in a 38px row — rather than a lookalike. A recursion is only honest if the
 * inner shell really is the outer one.
 */
type SurfaceView = "crew" | "clearance" | "knowledge";

const TABS: {
  id: SurfaceView;
  label: string;
  icon: "Layers" | "CircleCheck" | "Brain";
  title: string;
}[] = [
  { id: "crew", label: "Crew", icon: "Layers", title: "Crew overview" },
  { id: "clearance", label: "Clearance", icon: "CircleCheck", title: "Yours to clear" },
  { id: "knowledge", label: "Knowledge", icon: "Brain", title: "Knowledge" },
];

export function TowerRenderSurface({
  scopeThreadId,
  scopeLabel,
}: {
  /** The agent this surface belongs to. Omit for the root/pilot surface. */
  scopeThreadId?: string;
  /** The agent's handle — used to default its Knowledge to its own theme. */
  scopeLabel?: string;
}) {
  const [view, setView] = useState<SurfaceView>("crew");
  return (
    <div className="flex h-full min-h-0 flex-col bg-tower-render font-tower-sans">
      <div
        className="flex h-[38px] shrink-0 items-center gap-1 border-b border-tower-header-border bg-tower-header px-2 text-tower-tab"
        role="toolbar"
        aria-label={
          scopeLabel ? `${scopeLabel} panel views` : "Agent panel views"
        }
      >
        {TABS.map((t) => (
          <PinnedIconTab
            key={t.id}
            ariaLabel={`Show ${t.label.toLowerCase()}`}
            isActive={view === t.id}
            label={t.label}
            leadingVisual={<Icon name={t.icon} />}
            onClick={() => setView(t.id)}
            title={t.title}
            usesDesktopChrome={false}
            activeTreatment="fill"
          />
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {view === "crew" ? (
          <FleetOverviewTab scopeThreadId={scopeThreadId} />
        ) : view === "clearance" ? (
          <ClearanceTab scopeThreadId={scopeThreadId} />
        ) : (
          <KnowledgeTab scopeTheme={scopeLabel} />
        )}
      </div>
    </div>
  );
}

export default TowerRenderSurface;
