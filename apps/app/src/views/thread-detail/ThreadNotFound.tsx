import { useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  getProjectComposeRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths.js";

export type ThreadNotFoundReason = "missing" | "load-failed" | "bad-link";

const COPY: Record<ThreadNotFoundReason, { title: string; body: string }> = {
  missing: {
    title: "This conversation isn't here any more",
    body: "It was archived, deleted, or it belongs to a different project. Nothing you did caused this, and nothing else was affected.",
  },
  "load-failed": {
    title: "This conversation wouldn't load",
    body: "The app reached the server but couldn't read the thread back. It may be a passing fault — trying again is worth a shot before you go elsewhere.",
  },
  "bad-link": {
    title: "That link doesn't point at anything",
    body: "The address is missing the project or the thread it needs. It was probably copied from somewhere it had already gone stale.",
  },
};

/**
 * The end of a dead link. A bare "Not found" in red tells the operator that
 * something broke and then abandons them there; every route that can fail owes
 * them the same two things — what happened, in words, and a way back out.
 */
export function ThreadNotFound({
  reason,
  projectId,
  onRetry,
}: {
  reason: ThreadNotFoundReason;
  /** When known, offers the project this link was reaching for. */
  projectId?: string | null;
  /** Only offered when retrying could plausibly succeed. */
  onRetry?: () => void;
}) {
  const navigate = useNavigate();
  const { title, body } = COPY[reason];
  return (
    <PageShell contentClassName="min-h-full items-center justify-center">
      <div className="mx-auto max-w-[420px] py-16 text-center">
        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button onClick={onRetry} size="sm" variant="outline">
              Try again
            </Button>
          ) : null}
          {projectId ? (
            <Button
              onClick={() => navigate(getProjectComposeRoutePath(projectId))}
              size="sm"
              variant="outline"
            >
              Back to this project
            </Button>
          ) : null}
          <Button
            onClick={() => navigate(getRootComposeRoutePath())}
            size="sm"
            variant={onRetry || projectId ? "ghost" : "outline"}
          >
            Back to your crews
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

export default ThreadNotFound;
