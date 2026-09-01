import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getThreadRoutePath } from "@/lib/route-paths";
import {
  useCrews,
  type AgentLiveness,
  type Crew,
} from "@/components/sidebar/crew/useCrews";

interface FleetHomeProps {
  addProjectDisabled?: boolean;
  composer: ReactNode;
  onAddProject: () => void;
  onFocusComposer: () => void;
  onStartThread: () => void;
}

function describeLiveness(
  liveness: AgentLiveness | null,
  hasWorkingLead: boolean,
): string {
  if (hasWorkingLead) return "Working";
  if (liveness === null) return "Standing by";

  const verdict = liveness.verdict.toLowerCase();
  if (verdict.includes("work") || verdict.includes("live")) return "Working";
  if (verdict.includes("wait") || verdict.includes("idle")) {
    return "Standing by";
  }
  return liveness.verdict;
}

function FleetCrewStrip({ crew }: { crew: Crew }) {
  const workingLeadCount = crew.leads.filter((lead) => lead.working).length;
  const liveness = describeLiveness(crew.liveness, workingLeadCount > 0);

  return (
    <NavLink
      to={getThreadRoutePath({
        projectId: crew.projectId,
        threadId: crew.commanderThreadId,
      })}
      className="group flex min-w-[220px] flex-1 items-center gap-3 rounded-xl border border-border bg-card/60 px-3.5 py-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors group-hover:text-foreground",
          workingLeadCount > 0 && "text-foreground",
        )}
      >
        <Icon name="Code" className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">
          {crew.name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full bg-muted-foreground/50",
              workingLeadCount > 0 && "bg-foreground",
            )}
          />
          <span className="truncate">{liveness}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">
            {crew.leads.length} {crew.leads.length === 1 ? "lead" : "leads"}
          </span>
        </span>
      </span>
      {crew.attention > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium text-foreground">
          <Icon name="MessageQuestion" className="size-3" aria-hidden />
          {crew.attention}
        </span>
      ) : (
        <Icon
          name="ChevronRight"
          className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
          aria-hidden
        />
      )}
    </NavLink>
  );
}

interface QuickActionProps {
  description: string;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}

function QuickAction({
  description,
  disabled,
  icon,
  label,
  onClick,
}: QuickActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-card/40 px-3.5 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
        <Icon name={icon} className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

/** The root route is a quiet launch point. Work starts in the composer; the
 * fleet remains visible as a compact instrument below it. */
export function FleetHome({
  addProjectDisabled,
  composer,
  onAddProject,
  onFocusComposer,
  onStartThread,
}: FleetHomeProps) {
  const { crews, loaded, failed, timedOut, reload } = useCrews();
  const flying = crews.filter((crew) =>
    crew.leads.some((lead) => lead.working),
  ).length;
  const attention = crews.reduce((total, crew) => total + crew.attention, 0);

  return (
    <div className="flex w-full flex-col items-center gap-7 py-8 duration-500 animate-in fade-in-0 slide-in-from-bottom-2 sm:py-12">
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          What should we take on?
        </h1>
        <p className="max-w-lg text-sm text-muted-foreground">
          Name the outcome. Your commander will shape the right crew with you.
        </p>
      </header>

      <div className="w-full max-w-2xl">{composer}</div>

      <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-3">
        <QuickAction
          icon="MessageSquarePlus"
          label="New crew"
          description="Start with the outcome"
          onClick={onFocusComposer}
        />
        <QuickAction
          icon="FolderPlus"
          label="New project"
          description="Add a local folder"
          onClick={onAddProject}
          disabled={addProjectDisabled}
        />
        <QuickAction
          icon="MessageSquare"
          label="Plain chat"
          description="Start without a crew"
          onClick={onStartThread}
        />
      </div>

      <section
        className="w-full max-w-2xl"
        aria-labelledby="fleet-glance-title"
      >
        <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2
              id="fleet-glance-title"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Fleet glance
            </h2>
            {loaded && crews.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {flying > 0 ? `${flying} flying` : "Standing by"}
              </span>
            ) : null}
          </div>
          {attention > 0 ? (
            <span className="text-xs font-medium text-foreground">
              {attention} {attention === 1 ? "decision" : "decisions"} waiting
            </span>
          ) : null}
        </div>

        {!loaded ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
            <Icon name="Spinner" className="size-4 animate-spin" aria-hidden />
            Reading the fleet…
          </div>
        ) : failed && crews.length === 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {timedOut
                ? "The fleet hasn't answered yet."
                : "The fleet could not be reached."}
            </span>
            <Button onClick={reload} size="sm" variant="ghost">
              {timedOut ? "Wait longer" : "Try again"}
            </Button>
          </div>
        ) : crews.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            Your first crew will appear here.
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {crews.map((crew) => (
              <FleetCrewStrip key={crew.commanderThreadId} crew={crew} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default FleetHome;
