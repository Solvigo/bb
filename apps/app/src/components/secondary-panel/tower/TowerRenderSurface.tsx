import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
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
 */
type SurfaceView = "crew" | "clearance" | "knowledge";

const TABS: { id: SurfaceView; label: string; icon: "Layers" | "CircleCheck" | "Brain" }[] = [
  { id: "crew", label: "Crew", icon: "Layers" },
  { id: "clearance", label: "Clearance", icon: "CircleCheck" },
  { id: "knowledge", label: "Knowledge", icon: "Brain" },
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
      {/* tab bar — mirrors the top-level header tab row */}
      <div className="flex shrink-0 items-center gap-1 border-b border-tower-header-border bg-tower-header px-2 py-1 text-tower-tab">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={`Show ${t.label.toLowerCase()}`}
            onClick={() => setView(t.id)}
            className={
              "flex items-center gap-1.5 rounded-md px-2 py-1 font-tower-mono text-[9px] font-bold uppercase tracking-[0.1em] transition-colors " +
              (view === t.id
                ? "bg-tower-bright text-tower-fg"
                : "hover:bg-tower-bright/50")
            }
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
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
