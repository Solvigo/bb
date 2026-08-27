import { Icon, type IconName } from "@bb/shared-ui/icon";
import { AIRWAYS_BRAND_ASSETS } from "@/lib/brand-assets";

interface RootComposeEmptyWelcomeProps {
  /** Reveal the composer, optionally prefilled with a starter prompt. */
  onCompose: (prompt?: string) => void;
  onAddProject: () => void;
  addProjectDisabled?: boolean;
}

const IMPORT_PROJECTS_PROMPT =
  "Search my home directory (max depth 3) for git repositories touched in the last 30 days and import only those projects using the cli";

const LEARN_PROMPT =
  "What can bb do, and how can you (my agent) interact with it? Summarize bb's capabilities and how you'd use the bb CLI to work with threads and projects.";

interface WelcomeActionProps {
  icon: IconName;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}

function WelcomeAction({
  icon,
  title,
  description,
  onClick,
  disabled,
}: WelcomeActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon
        name={icon}
        aria-hidden
        className="size-5 shrink-0 text-subtle-foreground group-hover:text-foreground"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/**
 * Centered branded landing shown on the root compose page when the user has no
 * projects yet. Mirrors a logo-over-actions welcome layout: the approved
 * Airways mark sits above the primary "get started" actions.
 */
export function RootComposeEmptyWelcome({
  onCompose,
  onAddProject,
  addProjectDisabled,
}: RootComposeEmptyWelcomeProps) {
  return (
    <div className="flex flex-col items-center gap-12 duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
      <div
        role="img"
        aria-label="Solvigo Airways"
        className="size-24 select-none"
      >
        <img
          src={AIRWAYS_BRAND_ASSETS.largeMark}
          alt=""
          className="size-full select-none object-contain"
          draggable={false}
        />
      </div>
      <div className="flex w-full max-w-[360px] flex-col gap-1">
        <WelcomeAction
          icon="MessageSquarePlus"
          title="New thread"
          description="Start a new conversation"
          onClick={() => onCompose()}
        />
        <WelcomeAction
          icon="FolderGit"
          title="Automatically import my projects"
          description="Find repos touched in the last 30 days"
          onClick={() => onCompose(IMPORT_PROJECTS_PROMPT)}
        />
        <WelcomeAction
          icon="FolderPlus"
          title="New project"
          description="Create one from a local folder"
          onClick={onAddProject}
          disabled={addProjectDisabled}
        />
        <WelcomeAction
          icon="Explore"
          title="Learn what bb can do"
          description="Get a tour of its capabilities"
          onClick={() => onCompose(LEARN_PROMPT)}
        />
      </div>
    </div>
  );
}
