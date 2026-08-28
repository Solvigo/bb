import { createContext, useContext, type ReactNode } from "react";

/**
 * How an agent-surface tab asks the panel to put a file into the chat.
 *
 * The panel owns the composer's draft; a tab that wants to reference a file
 * hands over its path rather than reaching for the composer itself. Null when
 * the surface has no composer to add to, and a caller must treat that as "not
 * offered" rather than assuming — a button that silently does nothing is worse
 * than one that isn't there.
 */
export type AddPathToChat = ((path: string) => void) | null;

const AddPathToChatContext = createContext<AddPathToChat>(null);

export function WorktreeFileActionsProvider({
  addPathToChat,
  children,
}: {
  addPathToChat: AddPathToChat;
  children: ReactNode;
}) {
  return (
    <AddPathToChatContext.Provider value={addPathToChat}>
      {children}
    </AddPathToChatContext.Provider>
  );
}

export function useAddPathToChat(): AddPathToChat {
  return useContext(AddPathToChatContext);
}
