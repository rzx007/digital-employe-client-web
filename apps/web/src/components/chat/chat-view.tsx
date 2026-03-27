import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"

import { ConversationChatView } from "./chat-conversation-view"
import { DraftChatView } from "./chat-draft-view"

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
  const contact = useChatStore((s) => s.getSelectedContact())
  const { data: conversations = [] } = useConversationsQuery(
    selectedContactId,
    contact
  )

  const selectedConversation = conversations.find(
    (conversation) => String(conversation.id) === String(selectedConversationId)
  )

  // React.useEffect(() => {
  //   console.log("selectedContactId", isDraftConversation, selectedConversationId)
  // }, [selectedConversationId])

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
