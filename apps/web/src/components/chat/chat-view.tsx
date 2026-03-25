import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  useContactsQuery,
  useConversationsQuery,
} from "@/hooks/use-chat-queries"
import { findContactInList } from "@/lib/mock-data/ai-employees"
import { useChatStore } from "@/stores/chat-store"

import { ConversationChatView } from "./conversation-chat-view"
import { DraftChatView } from "./draft-chat-view"

export function ChatView({
  onOpenContacts,
  onOpenConversations,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  onOpenContacts?: () => void
  onOpenConversations?: () => void
}) {
  const selectedContactId = useChatStore((s) => s.selectedContactId)
  const isDraftConversation = useChatStore((s) => s.isDraftConversation)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)

  const { data: contacts = [] } = useContactsQuery()
  const { data: conversations = [] } = useConversationsQuery(selectedContactId)

  const contact = selectedContactId
    ? findContactInList(contacts, selectedContactId)
    : undefined

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId
  )

  return isDraftConversation || !selectedConversationId ? (
    <DraftChatView
      contact={contact}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      className={cn(className)}
      {...props}
    />
  ) : (
    <ConversationChatView
      contact={contact}
      title={selectedConversation?.title ?? "新对话"}
      conversationId={selectedConversationId}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      className={cn(className)}
      {...props}
    />
  )
}
