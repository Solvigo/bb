import { Link } from "react-router-dom";
import { useThread } from "@/hooks/queries/thread-queries";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import { PlatedInsignia, type Rank } from "./RankInsignia";

/** Strip substrate prefixes: the ranks are Commander, Lead and Sortie. */
function agentName(raw: string): string {
  return raw
    .replace(/^(sp|plt|cm)[\s·-]+/i, "")
    .replace(/^(sp|plt|cm)[-_]/i, "");
}

function TrailLink({
  projectId,
  rank,
  threadId,
  title,
}: {
  projectId: string;
  rank: Rank;
  threadId: string;
  title: string;
}) {
  return (
    <Link
      to={getThreadRoutePath({ projectId, threadId })}
      title={title}
      className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
    >
      <PlatedInsignia rank={rank} state="waiting" plate={18} />
      <span className="max-w-[16ch] truncate text-[12px]">{title}</span>
    </Link>
  );
}

/**
 * Where this agent sits in its crew, on the thread it belongs to.
 *
 * A deep link used to drop the operator onto a bare conversation with no way to
 * tell whose it was — the header said "child", which is substrate vocabulary
 * for a relationship the operator never asked about. This says the real thing:
 * the commander it answers to, the lead above it where there is one, and its
 * own rank. Every step is a link, so no thread is a dead end in the fleet.
 *
 * Renders only what it can actually resolve — an unreachable ancestor is left
 * out rather than guessed at.
 */
export function CrewContextTrail({
  parentThreadId,
}: {
  parentThreadId: string | null;
}) {
  const { data: parent } = useThread(parentThreadId ?? "");
  const grandparentId = parent?.parentThreadId ?? null;
  const { data: grandparent } = useThread(grandparentId ?? "");

  // Depth names the rank: a root is the commander, its children are leads, and
  // anything under a lead is a sortie.
  const commander = grandparent ?? parent;
  const lead = grandparent ? parent : null;

  // Nothing until the crew is actually known. A lone separator in front of the
  // title reads as a broken header, and on a slow instance that is exactly what
  // the operator would see while the ancestors are still resolving.
  if (!parentThreadId || !commander) return null;

  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <TrailLink
        projectId={commander.projectId}
        rank="commander"
        threadId={commander.id}
        title={agentName(getThreadDisplayTitle(commander))}
      />
      {lead ? (
        <>
          <span aria-hidden="true" className="text-[11px] text-tower-fg-faint">
            ›
          </span>
          <TrailLink
            projectId={lead.projectId}
            rank="lead"
            threadId={lead.id}
            title={agentName(getThreadDisplayTitle(lead))}
          />
        </>
      ) : null}
      <span aria-hidden="true" className="text-[11px] text-tower-fg-faint">
        ›
      </span>
    </span>
  );
}

export default CrewContextTrail;
