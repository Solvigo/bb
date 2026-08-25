import { NavLink } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { PlatedInsignia } from "@/components/secondary-panel/tower/RankInsignia";
import {
  AirwaysMark,
  AirwaysWordmark,
} from "@/components/sidebar/crew/BrandLockup";
import { useCrews, type Crew } from "@/components/sidebar/crew/useCrews";
import { useCreateCrew } from "@/components/sidebar/crew/useCreateCrew";

function CrewCard({ crew }: { crew: Crew }) {
  const working = crew.leads.filter((lead) => lead.working);
  return (
    <NavLink
      to={`/threads/${crew.commanderThreadId}`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-tower-input-border bg-tower-surface p-4 transition-colors hover:border-tower-accent"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <PlatedInsignia
          rank="commander"
          state={working.length > 0 ? "working" : "waiting"}
          plate={26}
        />
        {/* The status sits UNDER the name, not beside it: a crew's name is the
            thing being read, and sharing the line truncated it in a two-up
            grid — "Commander · Solvigo Airwa…". */}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">
            {crew.name}
          </span>
          <span className="truncate font-tower-mono text-[10px] text-tower-fg-faint">
            {crew.status}
          </span>
        </span>
      </div>
      {crew.leads.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {crew.leads.map((lead) => (
            <li key={lead.threadId} className="flex min-w-0 items-center gap-2">
              <PlatedInsignia
                rank="lead"
                state={lead.working ? "working" : "waiting"}
                plate={18}
              />
              <span className="min-w-0 truncate text-[13px] text-foreground">
                {lead.name}
              </span>
              {lead.status ? (
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
                  {lead.status}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] italic text-muted-foreground">
          No leads yet — open the commander and tell it what you need.
        </p>
      )}
    </NavLink>
  );
}

/**
 * What the operator lands on: their fleet, not an empty prompt.
 *
 * A bare composer invites starting work with nobody responsible for it, which
 * is the habit the crew-centric rail exists to break — so the first screen
 * answers "who is flying right now" instead. The plain composer is still one
 * click away, because an escape hatch that does not exist is not a choice.
 */
export function FleetHome({ onStartThread }: { onStartThread: () => void }) {
  const { crews, loaded, failed, timedOut, reload } = useCrews();
  const { createCrew, creating, error } = useCreateCrew();
  const flying = crews.filter((crew) =>
    crew.leads.some((lead) => lead.working),
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <AirwaysMark size={32} />
        <div className="min-w-0">
          <h1 className="text-lg text-foreground">
            <AirwaysWordmark />
          </h1>
          {/* Never claim an empty fleet before the fleet has been read. This
              screen once said "No crews yet" beside a rail listing a crew and
              its leads, at the same instant, because it was answering from a
              read that had not finished. */}
          <p className="text-[13px] text-muted-foreground">
            {!loaded
              ? "Reading the fleet…"
              : failed && crews.length === 0
                ? timedOut
                  ? "The fleet hasn't answered yet."
                  : "Couldn't read the fleet."
                : crews.length === 0
                  ? "No crews yet."
                  : flying > 0
                    ? `${flying} of ${crews.length} ${crews.length === 1 ? "crew is" : "crews are"} flying.`
                    : `${crews.length} ${crews.length === 1 ? "crew" : "crews"}, all standing by.`}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {crews.map((crew) => (
          <CrewCard key={crew.commanderThreadId} crew={crew} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {failed && crews.length === 0 ? (
          <Button onClick={reload} size="sm" variant="outline">
            {timedOut ? "Wait longer" : "Try again"}
          </Button>
        ) : null}
        <Button onClick={createCrew} disabled={creating} size="sm">
          {creating ? "Standing up a crew…" : "New crew"}
        </Button>
        <Button onClick={onStartThread} size="sm" variant="ghost">
          Start a plain thread instead
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-tower-accent-hover">{error}</p>
      ) : null}
    </div>
  );
}

export default FleetHome;
