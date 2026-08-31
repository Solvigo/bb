import { useCallback } from "react";
import { normalizeProjectPathInput } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { useDialogState } from "@/hooks/useDialogState";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useHosts, usePrimaryHost } from "@/hooks/queries/host-queries";
import { sdk } from "@/lib/sdk";
import type {
  ProjectPathDialogSubmitHandler,
  ProjectPathDialogTarget,
} from "@/components/dialogs/ProjectPathDialog";

export interface LocalPathSubmitParams {
  path: string;
  hostId: string;
  target: ProjectPathDialogTarget;
  closeDialog: () => void;
}

interface UseLocalPathPickerOptions {
  isPending: boolean;
  submit: (params: LocalPathSubmitParams) => void;
}

export interface LocalPathPickerController {
  isAvailable: boolean;
  hostId: string | null;
  hostName: string | null;
  /**
   * Open whichever path-entry surface fits this machine: the native folder
   * picker when there is exactly one connected host and the daemon supports it,
   * the in-app browser dialog otherwise. Callers that want a specific surface
   * can still reach `openPicker` / `projectPathDialog.onOpen` directly.
   */
  openPathEntry: (target: ProjectPathDialogTarget) => void;
  openPicker: (target: ProjectPathDialogTarget) => void;
  platform: HostPlatform | null;
  projectPathDialog: ReturnType<typeof useDialogState<ProjectPathDialogTarget>>;
  submitProjectPath: ProjectPathDialogSubmitHandler;
}

export interface PathPickerHost {
  canUseNativeFolderPicker: boolean;
  clientHostId: string | null;
  hostId: string | null;
  hostName: string | null;
}

/**
 * The host that path-entry flows (create project, add/update source) target.
 * The target is the connected work host. The local daemon is only used to
 * decide whether a native picker can be shown on the same physical machine.
 */
export function usePathPickerHost(): PathPickerHost {
  const { localDaemonHostId, supportsNativeFolderPicker } = useHostDaemon();
  const primaryHost = usePrimaryHost();

  const connectedPrimaryHostId =
    primaryHost?.status === "connected" ? primaryHost.id : null;
  const hostId = connectedPrimaryHostId ?? localDaemonHostId;
  const hostName =
    primaryHost && primaryHost.id === hostId ? primaryHost.name : null;
  // AND THIS CLIENT MUST BE THE DESKTOP SHELL. The other three conditions say
  // the HOST can raise a native folder panel — they say nothing about whether
  // the person who clicked is sitting in front of it. Served in a browser
  // tab, this asked the host machine to run an AppleScript `choose folder`
  // that the operator could not see or answer: the press produced no dialog,
  // no message and no error, and the in-app browser only arrived seconds
  // later when the request finally gave up. A native panel belongs to the
  // app that can actually show one.
  const canUseNativeFolderPicker =
    getBbDesktopInfo() !== null &&
    supportsNativeFolderPicker &&
    localDaemonHostId !== null &&
    hostId === localDaemonHostId;

  return {
    canUseNativeFolderPicker,
    clientHostId: localDaemonHostId,
    hostId,
    hostName,
  };
}

export function useLocalPathPicker({
  isPending,
  submit,
}: UseLocalPathPickerOptions): LocalPathPickerController {
  const { platform } = useHostDaemon();
  const { canUseNativeFolderPicker, clientHostId, hostId, hostName } =
    usePathPickerHost();
  const hostsQuery = useHosts();
  const isLoadingHosts = hostsQuery.isPending;
  const connectedHostCount = (hostsQuery.data ?? []).filter(
    (host) => host.status === "connected",
  ).length;
  const projectPathDialog = useDialogState<ProjectPathDialogTarget>();
  const closeDialog = projectPathDialog.onClose;

  // The target host is always passed explicitly: a default parameter would
  // only cover an omitted argument, and the dialog passes an explicit null
  // when no machine is selected — which would silently skip the fallback.
  const submitPath = useCallback(
    (
      path: string,
      target: ProjectPathDialogTarget,
      targetHostId: string | null,
    ) => {
      if (isPending || !targetHostId) return;
      submit({ path, hostId: targetHostId, target, closeDialog });
    },
    [closeDialog, isPending, submit],
  );

  const openPicker = useCallback(
    (target: ProjectPathDialogTarget) => {
      if (isPending || !hostId) return;

      if (canUseNativeFolderPicker && clientHostId !== null) {
        void (async () => {
          let selectedPath: string | null;
          try {
            selectedPath = (
              await sdk.hosts.pickFolder({ hostId, clientHostId })
            ).path;
          } catch {
            projectPathDialog.onOpen(target);
            return;
          }
          // NO PATH IS NOT AN ANSWER, it is the absence of one — and the
          // response carries nothing that tells a cancelled picker apart from
          // a picker that never appeared. Returning here made the press do
          // literally nothing: no dialog, no message, no error, on a daemon
          // that advertises the native picker and then answers null because
          // there is no desktop shell in front of it. The in-app browser is
          // the same fallback a thrown request already gets.
          if (!selectedPath) {
            projectPathDialog.onOpen(target);
            return;
          }
          submitPath(normalizeProjectPathInput(selectedPath), target, hostId);
        })();
        return;
      }

      projectPathDialog.onOpen(target);
    },
    [
      canUseNativeFolderPicker,
      clientHostId,
      hostId,
      isPending,
      projectPathDialog,
      submitPath,
    ],
  );

  const submitProjectPath = useCallback<ProjectPathDialogSubmitHandler>(
    (target, path, selectedHostId) => {
      submitPath(path, target, selectedHostId);
    },
    [submitPath],
  );

  // Only *connected* machines are choosable, so a lone stale enrollment must
  // not cost desktop users the native folder picker. While the host list is
  // still loading we cannot yet tell single- from multi-machine: open the
  // dialog, which grows the picker once the list arrives, rather than
  // committing to the primary host behind the user's back.
  const openPathEntry = useCallback(
    (target: ProjectPathDialogTarget) => {
      if (isLoadingHosts || connectedHostCount > 1) {
        projectPathDialog.onOpen(target);
        return;
      }
      openPicker(target);
    },
    [connectedHostCount, isLoadingHosts, openPicker, projectPathDialog],
  );

  return {
    isAvailable: hostId != null,
    hostId,
    hostName,
    openPathEntry,
    openPicker,
    platform,
    projectPathDialog,
    submitProjectPath,
  };
}
