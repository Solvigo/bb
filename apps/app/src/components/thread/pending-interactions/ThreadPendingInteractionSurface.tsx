import {
  isPluginPendingInteraction,
  type PendingInteraction,
} from "@bb/domain";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";

export interface ThreadPendingInteractionSurfaceProps {
  interaction: PendingInteraction;
  threadId: string;
}

/**
 * The thing a thread shows in place of its composer while an interaction is
 * waiting — a plugin's own form for a plugin-owned one, the built-in banner
 * otherwise.
 *
 * Every surface that hosts a composer renders this rather than choosing for
 * itself. Choosing was duplicated once, and the embedded copy handled only the
 * built-in case: a plugin interaction then rendered nothing at all, leaving a
 * live composer over a thread the server would refuse to accept a message for.
 */
export function ThreadPendingInteractionSurface({
  interaction,
  threadId,
}: ThreadPendingInteractionSurfaceProps) {
  if (isPluginPendingInteraction(interaction)) {
    return <PluginPendingInteractionComposer interaction={interaction} />;
  }
  return (
    <ThreadPendingInteractionBanner
      interaction={interaction}
      threadId={threadId}
    />
  );
}
