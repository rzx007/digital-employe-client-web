import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"
import type { ChatViewContact } from "@/components/chat/chat-view-shared"

export function useConversationAutoSelect(
  selectedContactId: string | null,
  contact?: ChatViewContact
) {
  const {
    selectedConversationId,
    isDraftConversation,
    setDraftConversation,
    setSelectedConversationId,
  } = useChatStore(
    useShallow((state) => ({
      selectedConversationId: state.selectedConversationId,
      isDraftConversation: state.isDraftConversation,
      setDraftConversation: state.setDraftConversation,
      setSelectedConversationId: state.setSelectedConversationId,
    }))
  )
  const { data: conversations = [], isSuccess: conversationsQuerySuccess } =
    useConversationsQuery(selectedContactId, contact)

  useEffect(() => {
    if (!selectedContactId) return

    if (!conversationsQuerySuccess) return

    if (conversations.length === 0) {
      if (selectedConversationId != null) {
        setSelectedConversationId(null)
        return
      }

      if (!isDraftConversation) {
        setDraftConversation(true)
      }
      return
    }

    if (isDraftConversation) {
      return
    }

    const hasSelected = conversations.some(
      (conversation) =>
        String(conversation.id) === String(selectedConversationId)
    )
    if (!hasSelected) {
      setSelectedConversationId(conversations[0].id)
    }
  }, [
    conversations,
    conversationsQuerySuccess,
    isDraftConversation,
    selectedContactId,
    selectedConversationId,
    setDraftConversation,
    setSelectedConversationId,
  ])
}
