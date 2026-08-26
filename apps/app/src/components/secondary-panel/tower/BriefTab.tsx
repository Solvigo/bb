import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { useEnvironmentFilePreview } from "@/hooks/queries/environment-queries";
import { SecondaryPanelEmptyState } from "@/components/secondary-panel/SecondaryPanelEmptyState";
import { useLiveThreads } from "./useLiveThreads";

/** Where a brief lives in an agent's workspace. One place, by convention. */
const BRIEF_PATH = ".bb/brief.md";

/** Strip the generated provenance comment before rendering the brief. */
function withoutHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").trimStart();
}

/** Read-only record of what this agent was asked to do. */
export function BriefTab({ agentId }: { agentId: string }) {
  const live = useLiveThreads()?.get(agentId);
  const environmentId = live?.environmentId ?? null;

  const brief = useEnvironmentFilePreview(
    environmentId,
    BRIEF_PATH,
    { kind: "working-tree" },
    { enabled: Boolean(environmentId) },
  );

  if (!environmentId) {
    return (
      <SecondaryPanelEmptyState
        icon="FileText"
        title="No brief available"
        description="This agent has no workspace, so it has no brief to read."
      />
    );
  }
  if (brief.isPending) {
    return (
      <SecondaryPanelEmptyState
        icon="Spinner"
        iconClassName="animate-spin"
        title="Reading brief"
        description="Reading this agent's brief and instructions…"
        aria-busy="true"
      />
    );
  }
  if (brief.isError) {
    return (
      <SecondaryPanelEmptyState
        icon="FileText"
        title="No brief available"
        description="No brief at .bb/brief.md — either this agent was never given one, or its workspace could not be read."
      />
    );
  }
  if (brief.data?.kind !== "text") {
    return (
      <SecondaryPanelEmptyState
        icon="FileText"
        title="Brief can't be displayed"
        description="The brief at .bb/brief.md is not text this can show."
      />
    );
  }

  const content = withoutHtmlComments(brief.data.content);
  if (content.trim().length === 0) {
    return (
      <SecondaryPanelEmptyState
        icon="FileText"
        title="Brief is empty"
        description="This agent's .bb/brief.md does not contain any instructions yet."
      />
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-5 py-4">
      <MarkdownPreview content={content} />
    </div>
  );
}

export default BriefTab;
