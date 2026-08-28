import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { deriveProjectNameFromPath, type Host } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import { useHosts } from "@/hooks/queries/host-queries";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import {} from "@/lib/route-paths";
import { useCreateCrew } from "@/components/sidebar/crew/useCreateCrew";
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

  const { createCrew } = useCreateCrew();

  const submit = useCallback(
    ({ path, hostId, target, closeDialog }: LocalPathSubmitParams) => {
      if (target.kind !== "create") return;
      const name = deriveProjectNameFromPath(path).trim();
      if (!name) return;

      mutate(
        {
          name,
          source: { type: "local_path", hostId, path },
        },
        {
          onSuccess: (project) => {
            closeDialog();
            setRootComposeProjectId(project.id);
            // A new project used to land on an empty compose view: the folder
            // existed and nothing was in it. Creating a project IS starting to
            // work on it, so it stands up the crew and drops you into that
            // chat, ready to type. createCrew owns the navigation, and it is
            // idempotent — a second create resumes an unfinished setup rather
            // than leaving another husk on the rail.
            createCrew(project.id);
          },
        },
      );
    },
    [createCrew, mutate, setRootComposeProjectId],
  );

  const controller = useLocalPathPicker({
    isPending,
    submit,
  });

  const openCreateDialog = useCallback(() => {
    controller.openPathEntry({ kind: "create" });
  }, [controller]);

  return useMemo(
    () => ({
      isAvailable: controller.isAvailable,
      isCreating: isPending,
      openCreateDialog,
      platform: controller.platform,
      hostId: controller.hostId,
      hostName: controller.hostName,
      hosts,
      projectPathDialog: controller.projectPathDialog,
      submitProjectPath: controller.submitProjectPath,
    }),
    [controller, hosts, isPending, openCreateDialog],
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
