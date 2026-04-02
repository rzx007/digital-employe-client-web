import * as React from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import type { UIMessage } from "ai"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"

import { ChatPanel } from "./chat-panel"
import { type ChatViewContact } from "./chat-view-shared"
import { useArtifactStore } from "@/stores/artifact-store"
import { toast } from "sonner"

export function ConversationChatView({
  contact,
  title,
  conversationId,
  initialMessages,
  onOpenContacts,
  onOpenConversations,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  title: string
  conversationId: string
  initialMessages: UIMessage[]
  onOpenContacts?: () => void
  onOpenConversations?: () => void
}) {
  const [inputValue, setInputValue] = React.useState("")
  const [command, setCommand] = React.useState<{
    id: string
    title: string
  } | null>(null)

  const SIMPLE_AGENTS_BASE = import.meta.env.DEV
    ? "/simple-agents/api/sessions"
    : "http://localhost:3005/api/sessions"
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<any>({
        prepareSendMessagesRequest({ messages, body }) {
          const skill = body?.skill ?? ""
          if (!conversationId) {
            throw new Error("缺少会话 ID")
          }
          return {
            body: { messages, skill },
            api: `${SIMPLE_AGENTS_BASE}/${conversationId}/chat/stream`,
          }
        },
        prepareReconnectToStreamRequest({ id }) {
          return {
            api: `${import.meta.env.DEV ? "/simple-agents" : "http://localhost:3005"}/api/sessions/${id}/chat/stream`,
          }
        },
      }),
    [conversationId]
  )

  const addArtifact = useArtifactStore((s) => s.addArtifact)

  const { messages, sendMessage, status, error, stop } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    resume: true,
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
    onData: (dataPart) => {
      if (dataPart.type === "data-artifact" && dataPart.data) {
        addArtifact(dataPart.data as any)
      }
    },
  })

  const handleTextChange = React.useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setInputValue(event.value)
  }, [])

  const isBusy = status === "submitted" || status === "streaming"

  const isSubmitDisabled = React.useMemo(() => {
    return !inputValue.trim() || isBusy
  }, [inputValue, isBusy])

  const handleSendMessage = React.useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text)
      const hasAttachments = Boolean(message.files?.length)
      const messageText = message.text?.trim() ?? ""

      const hasImageAttachment = Boolean(
        message.files?.some((file) => {
          const mediaType = "mediaType" in file ? file.mediaType : undefined
          const filename = "filename" in file ? file.filename : undefined

          return (
            mediaType?.startsWith("image/") ||
            Boolean(filename?.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i))
          )
        })
      )

      if (!(hasText || hasAttachments)) {
        return
      }

      if (hasImageAttachment) {
        toast.error("当前模型不支持图片输入，请移除图片后再发送")
        return
      }

      if (!messageText) {
        toast.error("暂不支持仅发送附件")
        return
      }

      if (message.files?.length) {
        toast.success("Files attached", {
          description: `${message.files.length} file(s) attached to message`,
        })
      }

      try {
        setInputValue("")

        await sendMessage(
          {
            text: messageText,
          },
          {
            body: {
              attachments: message.files,
              conversationId,
              skill: command?.title ?? "",
            },
          }
        )
      } catch (sendError) {
        toast.error("发送失败", {
          description:
            sendError instanceof Error ? sendError.message : "请稍后重试",
        })
      }
    },
    [conversationId, sendMessage, command]
  )

  return (
    <>
      <ChatPanel
        contact={contact}
        title={title}
        conversationId={conversationId}
        messages={messages}
        inputValue={inputValue}
        status={status}
        error={error}
        isDraftMode={false}
        isSubmitDisabled={isSubmitDisabled}
        onInputChange={handleTextChange}
        onSend={handleSendMessage}
        onStopStream={stop}
        onOpenContacts={onOpenContacts}
        onOpenConversations={onOpenConversations}
        className={className}
        {...props}
      />
    </>
  )
}
