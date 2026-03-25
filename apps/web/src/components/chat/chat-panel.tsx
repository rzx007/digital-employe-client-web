import * as React from "react"
import type { UIMessage } from "ai"

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { IconDots, IconMessages, IconUsers } from "@tabler/icons-react"

import { getTextFromUIMessage } from "@/lib/chat/message-utils"
import type { Message as StoredMessage } from "@/lib/mock-data/messages"
import { Spinner } from "@/components/spinner"
import { useArtifactStore } from "@/stores/artifact-store"

import { ArtifactPreview } from "../artifact"
import { ChatPromptInput } from "../chat-prompt-input"
import type { PromptChangeEvent } from "../lexical-editor/prompt-input-textarea"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import {
  getContactDisplayName,
  isMessageMetadata,
  type ChatViewContact,
} from "./chat-view-shared"

const EMPTY_MESSAGES: UIMessage[] = []

export function ChatPanel({
  contact,
  title,
  messages,
  storedMessages = [],
  inputValue,
  status,
  error,
  isDraftMode,
  isSubmitDisabled,
  onInputChange,
  onSend,
  onOpenContacts,
  onOpenConversations,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  title: string
  messages: UIMessage[]
  storedMessages?: StoredMessage[]
  inputValue: string
  status: "submitted" | "streaming" | "ready" | "error"
  error?: Error
  isDraftMode: boolean
  isSubmitDisabled: boolean
  onInputChange: (event: PromptChangeEvent) => void
  onSend: (message: PromptInputMessage) => Promise<void>
  onOpenContacts?: () => void
  onOpenConversations?: () => void
}) {
  const { openArtifact } = useArtifactStore()

  const contactDisplayName = contact
    ? getContactDisplayName(contact)
    : "AI 助手"

  const displayMessages = isDraftMode ? EMPTY_MESSAGES : messages
  const showStreamingIndicator =
    !isDraftMode &&
    (status === "submitted" || status === "streaming") &&
    !error &&
    displayMessages.length > 0

  const formatTime = React.useCallback((date: Date) => {
    return format(date, "HH:mm", { locale: zhCN })
  }, [])

  return (
    <div
      className={cn("flex flex-1 flex-col bg-background", className)}
      {...props}
    >
      {contact && (
        <>
          <div className="flex items-center justify-between border-b px-6 py-3">
            <div className="flex items-center gap-3">
              {(onOpenContacts || onOpenConversations) && (
                <>
                  {onOpenContacts && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={onOpenContacts}
                    >
                      <IconUsers className="size-4" />
                    </Button>
                  )}
                  {onOpenConversations && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={onOpenConversations}
                    >
                      <IconMessages className="size-4" />
                    </Button>
                  )}
                </>
              )}
              <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
                {title}
              </h3>
            </div>
            <Button variant="ghost" size="icon-sm">
              <IconDots className="size-4" />
            </Button>
          </div>

          <Conversation className="min-h-0 flex-1 overflow-y-auto pt-4">
            <ConversationContent>
              {isDraftMode ? (
                <ConversationEmptyState
                  title="开始新对话"
                  description="发送第一条消息后将自动创建会话"
                />
              ) : displayMessages.length === 0 ? (
                <ConversationEmptyState
                  title="暂无消息"
                  description="开始对话，在这里看到消息"
                />
              ) : (
                displayMessages.map((message) => {
                  const messageText = getTextFromUIMessage(message)
                  const storedMessage = storedMessages.find(
                    (item) => item.id === message.id
                  )
                  const timestamp = storedMessage?.timestamp
                  const metadata = isMessageMetadata(storedMessage?.metadata)
                    ? storedMessage.metadata
                    : null
                  const artifact = metadata?.artifact ?? null

                  return (
                    <Message key={message.id} from={message.role}>
                      {message.role === "assistant" && (
                        <div className="mb-2 flex items-center gap-2">
                          {contact.type === "group" ? (
                            <GroupMembersAvatar
                              participants={contact.group?.participants}
                              className="size-6"
                              itemClassName="h-3 w-3"
                              fallbackClassName="text-[8px]"
                              placeholderClassName="h-3 w-3"
                            />
                          ) : contact.type === "curator" ? (
                            <EmployeeContactAvatar
                              name={contact.curator?.name}
                              avatar={contact.curator?.avatar}
                              status={contact.curator?.status}
                              avatarClassName="size-6"
                              fallbackClassName="text-[10px]"
                            />
                          ) : (
                            <EmployeeContactAvatar
                              name={contact.employee?.name}
                              avatar={contact.employee?.avatar}
                              status={contact.employee?.status}
                              avatarClassName="size-6"
                              fallbackClassName="text-[10px]"
                            />
                          )}
                          <span className="text-xs text-muted-foreground">
                            {contactDisplayName}
                          </span>
                        </div>
                      )}
                      <MessageContent>
                        <MessageResponse>{messageText}</MessageResponse>
                      </MessageContent>
                      {timestamp && (
                        <div
                          className={cn(
                            "mt-1 text-[10px] text-muted-foreground",
                            message.role === "user" && "text-right"
                          )}
                        >
                          {formatTime(timestamp)}
                        </div>
                      )}
                      {artifact && (
                        <ArtifactPreview
                          artifact={artifact}
                          onClick={() => openArtifact(artifact.id)}
                        />
                      )}
                    </Message>
                  )
                })
              )}

              {showStreamingIndicator && (
                <Message from="assistant">
                  <MessageContent className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Spinner className="size-3.5" />
                      <span className="text-xs">正在生成回复...</span>
                    </div>
                  </MessageContent>
                </Message>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="border-t p-4">
            <ChatPromptInput
              value={inputValue}
              onChange={onInputChange}
              onSubmit={onSend}
              status={status}
              disabled={isSubmitDisabled}
              size="compact"
              className="w-full overflow-hidden"
            />
            {error && (
              <p className="mt-2 text-xs text-destructive">{error.message}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
