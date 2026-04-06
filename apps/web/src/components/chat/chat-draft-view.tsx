import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ComponentProps,
} from "react"
import { useChat } from "@ai-sdk/react"

import { SimpleAgentsTransport } from "@/lib/chat/simple-agents-transport"

import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import { useCreateConversationMutation } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"

import { ChatPanel } from "./chat-panel"
import { type ChatViewContact } from "./chat-view-shared"
import { toast } from "sonner"
import { useArtifactStore } from "@/stores/artifact-store"

export function DraftChatView({
  contact,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const selectedContactId = useChatStore((s) => s.selectedContactId)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const draftSessionKey = useChatStore((s) => s.draftSessionKey)
  const setSelectedConversationId = useChatStore(
    (s) => s.setSelectedConversationId
  )
  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const [inputValue, setInputValue] = useState("")
  const [command, setCommand] = useState<{ id: string; title: string } | null>(
    null
  )
  const createdConversationIdRef = useRef<string | number | null>(null)
  const createConversationMutation = useCreateConversationMutation()

  useEffect(() => {
    createdConversationIdRef.current = selectedConversationId
  }, [selectedConversationId])

  useEffect(() => {
    createdConversationIdRef.current = null
    setInputValue("")
  }, [draftSessionKey, selectedContactId])

  const draftTransport = useMemo(() => new SimpleAgentsTransport<any>(), [])

  const addArtifact = useArtifactStore((s) => s.addArtifact)

  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    addToolOutput,
    addToolApprovalResponse,
  } = useChat({
    id: selectedContactId
      ? `draft:${selectedContactId}:${draftSessionKey}`
      : `draft:chat-view:${draftSessionKey}`,
    transport: draftTransport,
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

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    console.log("🚀 ~ handleTextChange ~ event:", event)
    setCommand(event.command)
    setInputValue(event.value)
  }, [])

  const isBusy =
    createConversationMutation.isPending ||
    status === "submitted" ||
    status === "streaming"

  const isSubmitDisabled = useMemo(() => {
    return !inputValue.trim() || status === "streaming" || isBusy
  }, [inputValue, isBusy, status])

  const handleSendMessage = useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text)
      const messageText = message.text?.trim() ?? ""
      if (!hasText) {
        return
      }

      if (message.files?.length) {
        toast.success("Files attached", {
          description: `${message.files.length} file(s) attached to message`,
        })
      }

      try {
        let conversationId = createdConversationIdRef.current

        if (!conversationId) {
          const createdConversation =
            await createConversationMutation.mutateAsync({
              contactId: selectedContactId ?? "",
              title: messageText,
              contact: selectedContact,
            })

          conversationId = createdConversation.id
          createdConversationIdRef.current = conversationId
          setSelectedConversationId(conversationId)
        }

        setInputValue("")
        draftTransport.setSkill(command?.title ?? "")

        await sendMessage(
          {
            text: messageText,
          },
          {
            body: {
              attachments: message.files,
              conversationId,
            },
          }
        )
        toast.success("发送成功")
      } catch (sendError) {
        toast.error("发送失败", {
          description:
            sendError instanceof Error ? sendError.message : "请稍后重试",
        })
      }
    },
    [
      createConversationMutation,
      selectedContactId,
      selectedContact,
      sendMessage,
      setSelectedConversationId,
      command,
    ]
  )

  return (
    <>
      {JSON.stringify(messages)}

      <ChatPanel
        contact={contact}
        title="新对话"
        messages={messages}
        inputValue={inputValue}
        status={status}
        error={error}
        isDraftMode={messages.length === 0}
        isSubmitDisabled={isSubmitDisabled}
        onInputChange={handleTextChange}
        onSend={handleSendMessage}
        onStopStream={stop}
        onOpenContacts={onOpenContacts}
        onOpenConversations={onOpenConversations}
        onNewConversation={onNewConversation}
        addToolOutput={addToolOutput}
        addToolApprovalResponse={addToolApprovalResponse}
        onSendMessage={() => sendMessage({ text: "" })}
        className={className}
        {...props}
      />
    </>
  )
}
