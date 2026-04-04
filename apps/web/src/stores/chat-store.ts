import { create } from "zustand"
import { persist } from "zustand/middleware"

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

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      contacts: [],
      selectedContactId: DEFAULT_SELECTED_CONTACT_ID,
      selectedConversationId: null,
      isDraftConversation: false,
      draftSessionKey: 0,
      setContacts: (contacts) => set({ contacts }),
      setSelectedContactId: (id) => {
        if (get().selectedContactId === id) return
        set({
          selectedContactId: id,
          selectedConversationId: null,
          isDraftConversation: false,
          draftSessionKey: 0,
        })
      },
      setSelectedConversationId: (id) =>
        set({
          selectedConversationId: id != null ? String(id) : null,
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
    }),
    {
      name: "chat:selection",
      partialize: (state) => ({
        selectedContactId: state.selectedContactId,
        selectedConversationId: state.selectedConversationId,
        isDraftConversation: state.isDraftConversation,
        draftSessionKey: state.draftSessionKey,
      }),
    }
  )
)
