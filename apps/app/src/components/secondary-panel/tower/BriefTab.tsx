import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { useEnvironmentFilePreview } from "@/hooks/queries/environment-queries";
import { useLiveThreads } from "./useLiveThreads";

/** Where a brief lives in an agent's workspace. One place, by convention. */
const BRIEF_PATH = ".bb/brief.md";

/**
 * HTML comments are escaped rather than hidden here (the renderer runs with
 * HTML off, which is the right default for a file the operator did not write),
 * so the tool-stamp every generated brief opens with — "Written by
 * bb-plugin-crew" — would otherwise be the first line the operator reads.
 * It is provenance for the file, not content of the brief.
 */
function withoutHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").trimStart();
}

function Note({ children }: { children: string }) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-tower-fg-faint">
        {children}
      </p>
    </div>
  );
}

/**
 * What this agent was asked to do, read from its own workspace.
 *
 * Read-only on purpose. The brief is written before the work starts and is the
 * record of what was asked; a surface that let it be edited afterwards would
 * turn the record into a moving target, and the one question this tab answers
 * — "what was this agent actually told?" — would stop having an answer.
 *
 * Its four states are kept apart, because "this agent has no brief" and "I
 * could not read its brief" are different facts and only one of them is the
 * agent's own doing.
 */
export function BriefTab({ agentId }: { agentId: string }) {
  const live = useLiveThreads()?.get(agentId);
  const environmentId = live?.environmentId ?? null;

  const brief = useEnvironmentFilePreview(
    environmentId,
    BRIEF_PATH,
    { kind: "working-tree" },
    { enabled: Boolean(environmentId) },
  );

  // An agent on a personal or unmanaged workspace has no working tree to hold
  // a brief. That is a fact about the agent, not a failure to read one.
  if (!environmentId) {
    return <Note>This agent has no workspace, so it has no brief to read.</Note>;
  }
  if (brief.isPending) {
    return <Note>Reading this agent's brief…</Note>;
  }
  if (brief.isError) {
    return (
      <Note>
        No brief at .bb/brief.md — either this agent was never given one, or its
        workspace could not be read.
      </Note>
    );
  }
  if (brief.data?.kind !== "text") {
    return <Note>The brief at .bb/brief.md is not text this can show.</Note>;
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-5 py-4">
      <MarkdownPreview content={withoutHtmlComments(brief.data.content)} />
    </div>
  );
}

export default BriefTab;
