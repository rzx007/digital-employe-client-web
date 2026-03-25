import { create } from "zustand"

import { DEFAULT_SELECTED_CONTACT_ID } from "@/lib/mock-data/ai-employees"

interface ChatStore {
  selectedContactId: string | null
  selectedConversationId: string | null
  isDraftConversation: boolean
  draftSessionKey: number
  setSelectedContactId: (id: string | null) => void
  setSelectedConversationId: (id: string | null) => void
  setDraftConversation: (isDraft: boolean) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  selectedContactId: DEFAULT_SELECTED_CONTACT_ID,
  selectedConversationId: null,
  isDraftConversation: false,
  draftSessionKey: 0,
  setSelectedContactId: (id) =>
    set({
      selectedContactId: id,
      selectedConversationId: null,
      isDraftConversation: false,
      draftSessionKey: 0,
    }),
  setSelectedConversationId: (id) =>
    set({
      selectedConversationId: id,
    }),
  setDraftConversation: (isDraft) =>
    set((state) => ({
      isDraftConversation: isDraft,
      selectedConversationId: isDraft ? null : state.selectedConversationId,
      draftSessionKey: isDraft
        ? state.draftSessionKey + 1
        : state.draftSessionKey,
    })),
}))
