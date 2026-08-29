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
  onOpenChange,
  open,
  openingRequest,
  variant = "rail",
}: {
  className?: string;
  /**
   * Opens the project chooser without the trigger being pressed — for a
   * surface that asks its own question first and then needs this one asked.
   *
   * Controlled, rather than an imperative handle, for one reason: the project
   * question must stay ASKED. A ref that opened the menu could just as easily
   * grow a sibling that skipped it, and a commander born on the wrong project
   * can talk and never dispatch. Driving the menu still walks the operator
   * through the same choice, with `openingRequest` riding along.
   *
   * Omit both and the menu stays uncontrolled exactly as it was.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * What the operator already typed before pressing this, handed to the
   * commander as its first instruction.
   *
   * It rides THROUGH the project question rather than around it. A commander
   * is born on its project and can never move, so the question is asked first
   * whatever else is going on — a typed request is not a reason to skip it and
   * strand the crew on Personal, where it can talk and never dispatch.
   *
   * Empty or whitespace is the same as none; the hook trims and ignores it.
   */
  openingRequest?: string;
  variant?: "rail" | "page";
}) {
  const { createCrew, creating, error } = useCreateCrew();
  // Only pass a request when there IS one. With nothing typed the call keeps
  // its original shape — createCrew(projectId), createCrew() — rather than
  // trailing an explicit undefined. Callers that assert on how this is invoked
  // should not have to learn a new signature to say the same thing.
  const request = openingRequest?.trim() ? openingRequest : undefined;
  const startCrew = (forProjectId?: string) => {
    if (request === undefined) {
      if (forProjectId === undefined) createCrew();
      else createCrew(forProjectId);
      return;
    }
    createCrew(forProjectId, request);
  };
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
          "text-sidebar-foreground hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent disabled:opacity-60",
          className,
        )}
      >
        <Icon
          name="MessageSquarePlus"
          className="size-4 shrink-0 text-sidebar-foreground"
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
      <DropdownMenu
        {...(open === undefined ? {} : { open })}
        {...(onOpenChange === undefined ? {} : { onOpenChange })}
      >
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" mobileTitle="New crew">
          <DropdownMenuLabel>What is this crew for?</DropdownMenuLabel>
          {projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => startCrew(project.id)}
            >
              {project.name}
            </DropdownMenuItem>
          ))}
          {projects.length > 0 ? <DropdownMenuSeparator /> : null}
          {/* No code yet is still a choice ABOUT the project, so the request
              travels with it — a crew that only needs to think deserves the
              same opening instruction as one with a repo. */}
          <DropdownMenuItem onSelect={() => startCrew()}>
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
