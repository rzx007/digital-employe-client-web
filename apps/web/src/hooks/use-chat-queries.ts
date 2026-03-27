import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  createConversation,
  fetchContacts,
  fetchConversationsByContactId,
  fetchMessagesByConversationId,
} from "@/api/chat"
import type { Conversation } from "@/lib/mock-data/conversations"
import type { Message } from "@/lib/mock-data/messages"
import { chatKeys } from "@/lib/query-keys/chat"

export function useContactsQuery() {
  return useQuery({
    queryKey: chatKeys.contacts(),
    queryFn: fetchContacts,
  })
}

export function useConversationsQuery(contactId: string | null) {
  return useQuery({
    queryKey: chatKeys.conversations(contactId ?? ""),
    queryFn: () => fetchConversationsByContactId(contactId!),
    enabled: Boolean(contactId),
  })
}

export function useMessagesQuery(conversationId: string | null) {
  return useQuery({
    queryKey: chatKeys.messages(conversationId ?? ""),
    queryFn: () => fetchMessagesByConversationId(conversationId!),
    enabled: Boolean(conversationId),
  })
}

export function useCreateConversationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createConversation,
    onSuccess: (conversation) => {
      queryClient.setQueryData<Conversation[]>(
        chatKeys.conversations(conversation.contactId),
        (current) => {
          if (!current) {
            return [conversation]
          }

          const filtered = current.filter((item) => item.id !== conversation.id)
          return [conversation, ...filtered]
        }
      )
      queryClient.setQueryData<Message[]>(
        chatKeys.messages(conversation.id),
        []
      )
    },
  })
}
