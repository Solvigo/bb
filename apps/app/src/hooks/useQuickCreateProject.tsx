import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { deriveProjectNameFromPath, type Host } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import { useHosts } from "@/hooks/queries/host-queries";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import { APP_ROOT_ROUTE_PATH } from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import type {
  ProjectPathDialogSubmitHandler,
  ProjectPathDialogTarget,
} from "@/components/dialogs/ProjectPathDialog";

export interface QuickCreateProjectDialogState {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  target: ProjectPathDialogTarget | null;
}

export interface QuickCreateProjectController {
  isAvailable: boolean;
  isCreating: boolean;
  /** Why the last create failed, for the dialog that is still open on it. */
  createError: string | null;
  openCreateDialog: () => void;
  platform: HostPlatform | null;
  hostId: string | null;
  hostName: string | null;
  hosts: readonly Host[];
  projectPathDialog: QuickCreateProjectDialogState;
  submitProjectPath: ProjectPathDialogSubmitHandler;
}

const quickCreateProjectContext =
  createContext<QuickCreateProjectController | null>(null);
const EMPTY_HOSTS: readonly Host[] = [];

export function useQuickCreateProject(): QuickCreateProjectController {
  const { mutate, isPending } = useCreateProject();
  const hostsQuery = useHosts();
  const hosts = hostsQuery.data ?? EMPTY_HOSTS;
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const navigate = useNavigate();
  const [createError, setCreateError] = useState<string | null>(null);

  const submit = useCallback(
    ({ path, hostId, target, closeDialog }: LocalPathSubmitParams) => {
      if (target.kind !== "create") return;
      const name = deriveProjectNameFromPath(path).trim();
      if (!name) return;

      setCreateError(null);
      mutate(
        {
          name,
          source: { type: "local_path", hostId, path },
        },
        {
          onSuccess: (project) => {
            // Creating a project creates a PROJECT. It does not stand up an
            // agent: a root agent is governed — chartered, handled, bound to
            // its project — and pressing "New project" is not consent to spawn
            // one. The picker closes and the new project becomes the composer's
            // target, so the next thing typed starts there.
            closeDialog();
            setRootComposeProjectId(project.id);
            // Selecting the project is invisible from a thread route: the
            // composer that reads the selection is not on screen. Creating a
            // project ended with the dialog closing over the same thread the
            // operator was already looking at, and nothing to show for it.
            navigate(APP_ROOT_ROUTE_PATH);
          },
          // A failed create used to leave the dialog sitting there with the
          // button live again and nothing said. The picker is the only surface
          // on screen, so the refusal has to arrive in it.
          onError: (failure: unknown) => {
            setCreateError(
              failure instanceof Error && failure.message
                ? failure.message
                : "Could not create the project.",
            );
          },
        },
      );
    },
    [mutate, navigate, setRootComposeProjectId],
  );

  const controller = useLocalPathPicker({
    isPending,
    submit,
  });

  const openCreateDialog = useCallback(() => {
    setCreateError(null);
    controller.openPathEntry({ kind: "create" });
  }, [controller]);

  return useMemo(
    () => ({
      isAvailable: controller.isAvailable,
      isCreating: isPending,
      createError,
      openCreateDialog,
      platform: controller.platform,
      hostId: controller.hostId,
      hostName: controller.hostName,
      hosts,
      projectPathDialog: controller.projectPathDialog,
      submitProjectPath: controller.submitProjectPath,
    }),
    [controller, createError, hosts, isPending, openCreateDialog],
  );
}

interface QuickCreateProjectProviderProps {
  children: ReactNode;
}

export function QuickCreateProjectProvider({
  children,
}: QuickCreateProjectProviderProps) {
  const quickCreateProject = useQuickCreateProject();

  return (
    <quickCreateProjectContext.Provider value={quickCreateProject}>
      {children}
    </quickCreateProjectContext.Provider>
  );
}

export function useQuickCreateProjectController(): QuickCreateProjectController {
  const quickCreateProject = useContext(quickCreateProjectContext);
  if (!quickCreateProject) {
    throw new Error("QuickCreateProjectProvider is required");
  }
  return quickCreateProject;
}
