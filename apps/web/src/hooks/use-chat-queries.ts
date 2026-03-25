import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  createConversation,
  fetchContacts,
  fetchConversationsByContactId,
  fetchMessagesByConversationId,
  persistAssistantMessage,
  persistUserMessage,
} from "@/api/chat"
import { CONTACTS } from "@/lib/mock-data/ai-employees"
import type { Conversation } from "@/lib/mock-data/conversations"
import type { Message } from "@/lib/mock-data/messages"
import { chatKeys } from "@/lib/query-keys/chat"

export function useContactsQuery() {
  return useQuery({
    queryKey: chatKeys.contacts(),
    queryFn: fetchContacts,
    initialData: () => [...CONTACTS],
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

export function usePersistUserMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: persistUserMessage,
    onSuccess: (userMessage, variables) => {
      queryClient.setQueryData<Message[]>(
        chatKeys.messages(variables.conversationId),
        (current) => [...(current ?? []), userMessage]
      )

      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(variables.contactId),
      })
    },
  })
}

export function usePersistAssistantMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: persistAssistantMessage,
    onSuccess: (assistantMessage, variables) => {
      if (!assistantMessage) {
        return
      }

      queryClient.setQueryData<Message[]>(
        chatKeys.messages(variables.conversationId),
        (current) => [...(current ?? []), assistantMessage]
      )

      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(variables.contactId),
      })
    },
  })
}
