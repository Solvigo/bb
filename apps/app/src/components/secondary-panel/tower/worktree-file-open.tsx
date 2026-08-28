import { createContext, useContext, type ReactNode } from "react";

/**
 * How an agent-surface tab asks the panel to open a file.
 *
 * The panel already owns file tabs — their chrome, their previews, their close
 * buttons — so a tab that wants to open one hands over a path rather than
 * building a second viewer beside the first. Null when the surface has no
 * opener, and a caller must treat that as "not offered" rather than assuming.
 */
export type WorktreeFileOpener = ((path: string) => void) | null;

const WorktreeFileOpenContext = createContext<WorktreeFileOpener>(null);

export function WorktreeFileOpenProvider({
  children,
  openFile,
}: {
  children: ReactNode;
  openFile: WorktreeFileOpener;
}) {
  return (
    <WorktreeFileOpenContext.Provider value={openFile}>
      {children}
    </WorktreeFileOpenContext.Provider>
  );
}

export function useWorktreeFileOpener(): WorktreeFileOpener {
  return useContext(WorktreeFileOpenContext);
}
