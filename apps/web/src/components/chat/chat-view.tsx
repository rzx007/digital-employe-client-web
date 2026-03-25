import * as React from "react"

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
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputTools,
  PromptInputButton,
  type PromptInputMessage,
} from "@workspace/ui/components/ai-elements/prompt-input"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { MOCK_MESSAGES } from "@/lib/mock-data/messages"
import { getConversationById } from "@/lib/mock-data/conversations"
import {
  getContactById,
  getPeerProfileById,
} from "@/lib/mock-data/ai-employees"
import { IconDots, IconMessages, IconUsers } from "@tabler/icons-react"
import { ChatPromptInput } from "../chat-prompt-input"
import { useCallback, useMemo } from "react"
import type { PromptChangeEvent } from "../lexical-editor/prompt-input-textarea"
import { toast } from "sonner"
import { ArtifactPreview } from "../artifact"
import { useArtifactStore } from "@/stores/artifact-store"

export function ChatView({
  selectedConversationId,
  selectedContactId,
  onOpenContacts,
  onOpenConversations,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  selectedConversationId?: string
  selectedContactId?: string
  onOpenContacts?: () => void
  onOpenConversations?: () => void
}) {
  const [inputValue, setInputValue] = React.useState("")
  const [status, setStatus] = React.useState<
    "submitted" | "streaming" | "ready" | "error"
  >()
  const conversation = getConversationById(selectedConversationId || "")
  const contact = getContactById(selectedContactId || "")
  const messages = MOCK_MESSAGES[selectedConversationId || ""] || []

  const handleTextChange = useCallback(
    (event: PromptChangeEvent) => {
      console.log("handleTextChange", event)
      setInputValue(event.value)
    },
    [setInputValue]
  )

  const formatTime = (date: Date) => {
    return format(date, "HH:mm", { locale: zhCN })
  }

  const isSubmitDisabled = useMemo(
    () => !(inputValue.trim() || status) || status === "streaming",
    [inputValue, status]
  )

  const handleSendMessage = useCallback(
    (message: PromptInputMessage) => {
      console.log("handleSubmit", message)
      const hasText = Boolean(message.text)
      const hasAttachments = Boolean(message.files?.length)

      if (!(hasText || hasAttachments)) {
        return
      }

      if (message.files?.length) {
        toast.success("Files attached", {
          description: `${message.files.length} file(s) attached to message`,
        })
      }

      console.log("发送消息:", { text: message.text })
      setInputValue("")
    },
    [setInputValue]
  )
  const { openArtifact, closeArtifact, addArtifact } = useArtifactStore()

  return (
    <div
      className={cn("flex flex-1 flex-col bg-background", className)}
      {...props}
    >
      {conversation && contact && (
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
              {contact.type === "group" ? (
                <>
                  <AvatarGroup className="-space-x-2">
                    {contact.group?.participants.slice(0, 3).map((p) => (
                      <Avatar
                        key={p.id}
                        className="h-8 w-8 border-2 border-background"
                      >
                        <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                          {p.name.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </AvatarGroup>
                  <div>
                    <h3 className="text-sm font-medium">
                      {contact.group?.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {contact.group?.participants.length} 位成员
                    </p>
                  </div>
                </>
              ) : contact.type === "curator" ? (
                <>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                      {contact.curator?.name.slice(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-sm font-medium">
                      {contact.curator?.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {contact.curator?.role}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                      {contact.employee?.name.slice(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-sm font-medium">
                      {contact.employee?.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {contact.employee?.role}
                    </p>
                  </div>
                </>
              )}
            </div>
            <Button variant="ghost" size="icon-sm">
              <IconDots className="size-4" />
            </Button>
          </div>

          <Conversation className="min-h-0 flex-1 overflow-y-auto pt-4">
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  title="暂无消息"
                  description="开始对话，在这里看到消息"
                />
              ) : (
                messages.map((message) => {
                  const sender = getPeerProfileById(message.senderId)
                  const meta = message.metadata ?? ({} as any)
                  const hasArtifact = meta?.artifactToolCallId && meta?.artifact
                  const handleOpenArtifact = () => {
                    if (meta?.artifact) {
                      openArtifact(meta.artifact.id)
                    }
                  }
                  return (
                    <Message key={message.id} from={message.role}>
                      {message.role === "assistant" && sender && (
                        <div className="mb-2 flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="bg-primary text-[10px] font-medium text-primary-foreground">
                              {sender.name.slice(0, 1)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs text-muted-foreground">
                            {sender.name}
                          </span>
                        </div>
                      )}
                      <MessageContent>
                        <MessageResponse>{message.content}</MessageResponse>
                      </MessageContent>
                      <div
                        className={cn(
                          "mt-1 text-[10px] text-muted-foreground",
                          message.role === "user" && "text-right"
                        )}
                      >
                        {formatTime(message.timestamp)}
                      </div>
                      {hasArtifact && (
                        <ArtifactPreview
                          artifact={meta.artifact}
                          onClick={handleOpenArtifact}
                        />
                      )}
                    </Message>
                  )
                })
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="border-t p-4">
            <ChatPromptInput
              value={inputValue}
              onChange={handleTextChange}
              onSubmit={handleSendMessage}
              status={status as "submitted" | "streaming" | "ready" | "error"}
              disabled={isSubmitDisabled}
              size="compact"
              className="w-full overflow-hidden"
            />
            {/* <PromptInput onSubmit={handleSendMessage}>
              <PromptInputBody>
                <PromptInputTextarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="输入消息..."
                />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools>
                  <PromptInputButton
                    variant="ghost"
                    size="icon-sm"
                    tooltip="上传文件"
                  >
                    📎
                  </PromptInputButton>
                </PromptInputTools>
                <PromptInputSubmit variant="default" />
              </PromptInputFooter>
            </PromptInput> */}
          </div>
        </>
      )}
    </div>
  )
}
