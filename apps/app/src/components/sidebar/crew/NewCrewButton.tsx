import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useCreateCrew } from "./useCreateCrew";

/**
 * The one action the rail is built around — and the one question it has to ask.
 *
 * A commander is created ON the project its crew is for and can never move
 * afterwards, so choosing later is not an option: a commander made in the wrong
 * place can talk but can never dispatch. The question is therefore asked here,
 * once, instead of being discovered as a wall an hour into real work.
 *
 * "No code yet" is a real answer, not an escape hatch — a crew that only needs
 * to think belongs on the personal project, and that is the case the fast
 * repo-less commander was built for.
 */
export function NewCrewButton({
  className,
  variant = "rail",
}: {
  className?: string;
  variant?: "rail" | "page";
}) {
  const { createCrew, creating, error } = useCreateCrew();
  const navigation = useSidebarNavigation();
  const projects = (navigation.data?.projects ?? []).filter(
    (project) => project.id !== PERSONAL_PROJECT_ID,
  );

  const trigger =
    variant === "rail" ? (
      <button
        type="button"
        disabled={creating}
        data-testid="new-crew-button"
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
          "text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-60",
          className,
        )}
      >
        <Icon
          name="MessageSquarePlus"
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">
          {creating ? "Standing up a crew…" : "New crew"}
        </span>
      </button>
    ) : (
      <button
        type="button"
        disabled={creating}
        data-testid="new-crew-button"
        className={cn(
          "inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60",
          className,
        )}
      >
        {creating ? "Standing up a crew…" : "New crew"}
      </button>
    );

  return (
    <div className="flex flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" mobileTitle="New crew">
          <DropdownMenuLabel>What is this crew for?</DropdownMenuLabel>
          {projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => createCrew(project.id)}
            >
              {project.name}
            </DropdownMenuItem>
          ))}
          {projects.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => createCrew()}>
            No code yet — just thinking
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p className="px-2 text-xs text-destructive-text">{error}</p>
      ) : null}
    </div>
  );
}

export default NewCrewButton;
