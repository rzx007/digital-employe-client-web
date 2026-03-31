import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  useConversationsQuery,
  useMessagesQuery,
} from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"

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

  const { data: messagesData, isLoading: isMessagesLoading } = useMessagesQuery(
    isDraftConversation ? null : selectedConversationId
  )

  const initialMessages = React.useMemo(
    () => mapStoredMessagesToUIMessages(messagesData ?? []),
    [messagesData]
  )

  return isDraftConversation || !selectedConversationId ? (
    <DraftChatView
      contact={contact}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      className={cn(className)}
      {...props}
    />
  ) : isMessagesLoading ? (
    <ChatLoadingSkeleton className={cn(className)} />
  ) : (
    <ConversationChatView
      key={selectedConversationId}
      contact={contact}
      title={selectedConversation?.title ?? "新对话"}
      conversationId={selectedConversationId}
      initialMessages={initialMessages}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      className={cn(className)}
      {...props}
    />
  )
}

function ChatLoadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 bg-background",
        className
      )}
    >
      <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
      <span className="text-sm text-muted-foreground">加载中...</span>
    </div>
  )
}
