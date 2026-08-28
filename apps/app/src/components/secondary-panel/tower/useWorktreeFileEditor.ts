import { useCallback, useState } from "react";
import { sdk } from "@/lib/sdk";

interface OpenEditor {
  path: string;
  text: string;
  /** What the file hashed to when it was opened — the guard against clobbering. */
  baseSha256: string;
}

export type EditorStatus =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  /**
   * Someone else wrote the file while it was open. Never resolved by writing
   * anyway: an agent working in this worktree is the likeliest someone else,
   * and overwriting its work silently is the worst thing this panel could do.
   */
  | { kind: "conflict" };

export interface WorktreeFileEditor {
  editing: OpenEditor | null;
  status: EditorStatus;
  open: (path: string) => void;
  setText: (text: string) => void;
  save: () => void;
  cancel: () => void;
}

/**
 * Editing a file in an agent's own worktree.
 *
 * The worktree is the sanctioned write surface — it is the agent's isolated
 * checkout, not a shared one — so this writes through the host's file
 * primitives directly. Every save carries the hash the file had when it was
 * opened, so a write that would land on top of someone else's is refused by
 * the host rather than detected here.
 */
export function useWorktreeFileEditor(args: {
  hostId: string | null;
  rootPath: string | null;
  onSaved?: () => void;
}): WorktreeFileEditor {
  const { hostId, rootPath, onSaved } = args;
  const [editing, setEditing] = useState<OpenEditor | null>(null);
  const [status, setStatus] = useState<EditorStatus>({ kind: "idle" });

  const absolutePath = useCallback(
    (path: string) => (rootPath === null ? null : `${rootPath}/${path}`),
    [rootPath],
  );

  const open = useCallback(
    (path: string) => {
      const target = absolutePath(path);
      if (target === null) return;
      setStatus({ kind: "opening" });
      void (async () => {
        try {
          const file = await sdk.files.read({
            ...(hostId === null ? {} : { hostId }),
            path: target,
          });
          if (file.contentEncoding !== "utf8") {
            setStatus({
              kind: "error",
              message: "This file isn't text, so it can't be edited here.",
            });
            return;
          }
          setEditing({ path, text: file.content, baseSha256: file.sha256 });
          setStatus({ kind: "idle" });
        } catch (error) {
          setStatus({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not open the file.",
          });
        }
      })();
    },
    [absolutePath, hostId],
  );

  const setText = useCallback((text: string) => {
    setEditing((current) => (current === null ? null : { ...current, text }));
  }, []);

  const save = useCallback(() => {
    if (editing === null) return;
    const target = absolutePath(editing.path);
    if (target === null) return;
    setStatus({ kind: "saving" });
    void (async () => {
      try {
        const result = await sdk.files.write({
          ...(hostId === null ? {} : { hostId }),
          path: target,
          content: editing.text,
          expectedSha256: editing.baseSha256,
        });
        if (result.outcome === "conflict") {
          setStatus({ kind: "conflict" });
          return;
        }
        setEditing(null);
        setStatus({ kind: "idle" });
        onSaved?.();
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Could not save the file.",
        });
      }
    })();
  }, [absolutePath, editing, hostId, onSaved]);

  const cancel = useCallback(() => {
    setEditing(null);
    setStatus({ kind: "idle" });
  }, []);

  return { editing, status, open, setText, save, cancel };
}
