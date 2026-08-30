import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import type { QuickCreateProjectController } from "@/hooks/useQuickCreateProject";

/**
 * The rail's primary action: stand up a project (and its crew) from a folder.
 *
 * Project creation already hands off to `createCrew` on success, so this is the
 * landing flow the Captain asked for — start from the folder, not from a bare
 * crew picker.
 */
export function NewProjectButton({
  quickCreateProject,
  className,
}: {
  quickCreateProject: QuickCreateProjectController;
  className?: string;
}) {
  if (!quickCreateProject.isAvailable) return null;

  return (
    <button
      type="button"
      data-testid="new-project-button"
      onClick={quickCreateProject.openCreateDialog}
      disabled={quickCreateProject.isCreating}
      aria-label="New project from a folder"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
        "text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-60",
        className,
      )}
    >
      <Icon
        name="FolderPlus"
        className="size-4 shrink-0 text-sidebar-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        {quickCreateProject.isCreating ? "Creating a project…" : "New project"}
      </span>
    </button>
  );
}

export default NewProjectButton;
