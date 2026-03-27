import { create } from "zustand"

import {
  DEFAULT_SELECTED_CONTACT_ID,
  findContactInList,
  type Contact,
} from "@/lib/mock-data/ai-employees"

interface ChatStore {
  contacts: Contact[]
  selectedContactId: string | null
  selectedConversationId: string | null
  isDraftConversation: boolean
  draftSessionKey: number
  setContacts: (contacts: Contact[]) => void
  setSelectedContactId: (id: string | null) => void
  setSelectedConversationId: (id: string | null) => void
  setDraftConversation: (isDraft: boolean) => void
  getSelectedContact: () => Contact | undefined
}

export const useChatStore = create<ChatStore>((set, get) => ({
  contacts: [],
  selectedContactId: DEFAULT_SELECTED_CONTACT_ID,
  selectedConversationId: null,
  isDraftConversation: false,
  draftSessionKey: 0,
  setContacts: (contacts) => set({ contacts }),
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
  getSelectedContact: () => {
    const { contacts, selectedContactId } = get()
    if (!selectedContactId) return undefined
    return findContactInList(contacts, selectedContactId)
  },
}))
