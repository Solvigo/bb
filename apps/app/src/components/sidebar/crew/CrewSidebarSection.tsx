import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PlatedInsignia } from "@/components/secondary-panel/tower/RankInsignia";
import { useCrews, type Crew } from "./useCrews";
import { useCreateCrew } from "./useCreateCrew";

export const SIDEBAR_SECTION_LABEL_CLASS =
  "px-2 font-tower-mono text-[9px] font-bold uppercase tracking-[0.14em] text-tower-fg-dim";

function CrewEntry({
  crew,
  onNavigate,
}: {
  crew: Crew;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const anyWorking = crew.leads.some((l) => l.working);
  return (
    <li>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={open ? `Collapse ${crew.name}` : `Expand ${crew.name}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid size-5 shrink-0 place-items-center rounded text-subtle-foreground hover:bg-state-hover"
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5" />
        </button>
        <NavLink
          to={`/threads/${crew.commanderThreadId}`}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              isActive ? "bg-state-active" : "hover:bg-state-hover",
            )
          }
        >
          <PlatedInsignia
            rank="commander"
            state={anyWorking ? "working" : "waiting"}
            plate={22}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {crew.name}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {crew.status}
            </span>
          </span>
        </NavLink>
      </div>
      {open && crew.leads.length > 0 ? (
        <ul className="mt-0.5 ml-6 flex flex-col gap-0.5">
          {crew.leads.map((lead) => (
            <li key={lead.threadId}>
              <NavLink
                to={`/threads/${lead.threadId}`}
                onClick={onNavigate}
                title={lead.status ?? undefined}
                className={({ isActive }) =>
                  cn(
                    "flex min-w-0 items-center gap-2 rounded-md px-2 py-1 transition-colors",
                    isActive ? "bg-state-active" : "hover:bg-state-hover",
                  )
                }
              >
                <PlatedInsignia
                  rank="lead"
                  state={lead.working ? "working" : "waiting"}
                  plate={18}
                />
                <span className="truncate text-[13px] text-foreground">
                  {lead.name}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The sidebar's primary object is the CREW, not the thread: a New-crew button,
 * then one entry per crew — its commander, expanding to the leads reporting to
 * it. Raw threads keep their own section below this one, so every existing
 * route still works; they are simply no longer the first thing the operator
 * sees.
 */
/**
 * The one action the rail is built around. Pressing it stands up a commander
 * that interviews the operator; pressing it twice resumes that interview rather
 * than leaving a second half-built crew behind.
 */
export function NewCrewButton() {
  const { createCrew, creating, error } = useCreateCrew();
  return (
    <div className="flex flex-col gap-1 px-2 group-data-[collapsible=icon]:hidden">
      <button
        type="button"
        onClick={createCrew}
        disabled={creating}
        data-testid="new-crew-button"
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border border-tower-input-border bg-tower-input px-3 py-2 text-left transition-colors",
          "hover:border-tower-accent hover:bg-state-hover disabled:opacity-60",
        )}
      >
        <PlatedInsignia rank="commander" state="working" plate={24} />
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">
            {creating ? "Standing up a crew…" : "New crew"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            A commander walks you through it
          </span>
        </span>
      </button>
      {error ? (
        <p className="px-1 text-xs text-tower-accent-hover">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * The rail's primary object is the CREW, not the thread: one entry per crew —
 * its commander, expanding to the leads reporting to it. Raw threads keep a
 * collapsed disclosure at the very bottom, so every existing route still works;
 * they are simply no longer what the operator reads first.
 */
export function CrewSidebarSection({
  headerTrailing,
  onNavigate,
}: {
  /** Sits on the Crews heading — search belongs beside what it searches. */
  headerTrailing?: ReactNode;
  onNavigate?: () => void;
}) {
  const { crews, loaded, failed, reload } = useCrews();

  return (
    <div className="flex flex-col gap-1 px-2 pb-2 group-data-[collapsible=icon]:hidden">
      <div className="mt-2 mb-0.5 flex items-center justify-between gap-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS}>Crews</span>
        {headerTrailing}
      </div>
      {!loaded ? (
        <p className="px-2 py-1 text-xs italic text-muted-foreground">
          Reading the fleet…
        </p>
      ) : failed && crews.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Couldn&apos;t read the fleet.{" "}
          <button
            type="button"
            onClick={reload}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Try again
          </button>
        </p>
      ) : crews.length === 0 ? (
        <p className="px-2 py-1 text-xs italic text-muted-foreground">
          No crews yet — start one above.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {crews.map((crew) => (
            <CrewEntry
              key={crew.commanderThreadId}
              crew={crew}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default CrewSidebarSection;
