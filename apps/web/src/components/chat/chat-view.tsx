import * as React from "react"
import { useChat } from "@ai-sdk/react"
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
import {
  useContactsQuery,
  useConversationsQuery,
  useCreateConversationMutation,
  useMessagesQuery,
  usePersistAssistantMessageMutation,
  usePersistUserMessageMutation,
} from "@/hooks/use-chat-queries"
import { findContactInList } from "@/lib/mock-data/ai-employees"
import {
  getTextFromUIMessage,
  mapStoredMessagesToUIMessages,
} from "@/lib/chat/message-utils"
import { LangChainChatTransport } from "@/lib/chat/langchain-chat-transport"
import { Spinner } from "@/components/spinner"
import type { Artifact } from "@/types/artifact"
import { useChatStore } from "@/stores/chat-store"
import { useArtifactStore } from "@/stores/artifact-store"
import { IconDots, IconMessages, IconUsers } from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"

import { ArtifactPreview } from "../artifact"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { ChatPromptInput } from "../chat-prompt-input"
import type { PromptChangeEvent } from "../lexical-editor/prompt-input-textarea"

// 创建聊天传输实例，用于与后端通信
const chatTransport = new LangChainChatTransport<UIMessage>()

// 空消息数组常量
const EMPTY_MESSAGES: UIMessage[] = []

/**
 * 待处理的首条消息接口
 */
interface PendingFirstMessage {
  conversationId: string
  text: string
}

/**
 * 检查元数据是否为消息元数据
 */
function isMessageMetadata(metadata: unknown): metadata is {
  artifactToolCallId?: string
  artifact?: Artifact
} {
  return typeof metadata === "object" && metadata !== null
}

/**
 * 获取联系人的显示名称
 */
function getContactDisplayName(
  contact: NonNullable<ReturnType<typeof findContactInList>>
) {
  // 如果是群组，返回群组名称或默认"群组"
  if (contact.type === "group") {
    return contact.group?.name ?? "群组"
  }

  // 如果是策展人，返回策展人名称或默认"AI 助手"
  if (contact.type === "curator") {
    return contact.curator?.name ?? "AI 助手"
  }

  // 默认返回员工名称或"AI 助手"
  return contact.employee?.name ?? "AI 助手"
}

/**
 * 聊天视图组件
 * 提供完整的聊天界面，包括消息展示、输入区域、联系人管理等功能
 */
export function ChatView({
  onOpenContacts,
  onOpenConversations,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  onOpenContacts?: () => void
  onOpenConversations?: () => void
}) {
  // 从聊天存储中获取状态
  const selectedContactId = useChatStore((s) => s.selectedContactId) // 当前选中的联系人ID
  const isDraftConversation = useChatStore((s) => s.isDraftConversation) // 是否为草稿对话
  const selectedConversationId = useChatStore((s) => s.selectedConversationId) // 当前选中的对话ID
  const setDraftConversation = useChatStore((s) => s.setDraftConversation) // 设置草稿对话状态
  const setSelectedConversationId = useChatStore(
    (s) => s.setSelectedConversationId
  ) // 设置选中的对话ID

  // 输入值状态
  const [inputValue, setInputValue] = React.useState("")

  // 待处理的首条消息状态
  const [pendingFirstMessage, setPendingFirstMessage] =
    React.useState<PendingFirstMessage | null>(null)

  // 当前等待持久化助手回复的会话ID，仅在本轮真实发送后才允许写回
  const [
    pendingAssistantPersistenceConversationId,
    setPendingAssistantPersistenceConversationId,
  ] = React.useState<string | null>(null)

  // 上一次持久化助手消息的引用
  const lastPersistedAssistantTextRef = useRef("")

  // 获取联系人数据
  const { data: contacts = [] } = useContactsQuery()
  // 根据ID查找联系人
  const contact = selectedContactId
    ? findContactInList(contacts, selectedContactId)
    : undefined
  // 获取联系人显示名称
  const contactDisplayName = contact
    ? getContactDisplayName(contact)
    : "AI 助手"

  // 获取当前联系人的对话列表
  const { data: conversations = [] } = useConversationsQuery(selectedContactId)
  // 查找当前选中的对话
  const conversationForTitle = conversations.find(
    (conversation) => conversation.id === selectedConversationId
  )

  // 获取当前对话的消息列表
  const { data: storedMessages = [] } = useMessagesQuery(selectedConversationId)

  // 各种mutation hooks用于数据操作
  const createConversationMutation = useCreateConversationMutation()
  const persistUserMessageMutation = usePersistUserMessageMutation()
  const persistAssistantMessageMutation = usePersistAssistantMessageMutation()

  // 获取打开工件的方法
  const { openArtifact } = useArtifactStore()

  // 将存储的消息映射为UI消息的备忘录
  const initialMessages = useMemo(
    () => mapStoredMessagesToUIMessages(storedMessages),
    [storedMessages]
  )

  // 使用AI SDK的useChat hook管理聊天状态
  const { messages, sendMessage, status, error } = useChat({
    id: selectedConversationId ?? undefined,
    messages: initialMessages,
    transport: chatTransport,
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
  })

  // 重置助手文本引用，当对话改变时
  useEffect(() => {
    lastPersistedAssistantTextRef.current = ""
  }, [selectedConversationId])

  // 处理待处理的首条消息
  useEffect(() => {
    if (!pendingFirstMessage) {
      return
    }

    if (selectedConversationId !== pendingFirstMessage.conversationId) {
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        setPendingAssistantPersistenceConversationId(
          pendingFirstMessage.conversationId
        )
        await sendMessage({
          text: pendingFirstMessage.text,
        })

        if (!cancelled) {
          setPendingFirstMessage(null)
        }
      } catch (sendError) {
        if (!cancelled) {
          setPendingFirstMessage(null)
          setPendingAssistantPersistenceConversationId(null)
          toast.error("发送失败", {
            description:
              sendError instanceof Error ? sendError.message : "请稍后重试",
          })
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [
    pendingFirstMessage,
    selectedConversationId,
    sendMessage,
    setPendingAssistantPersistenceConversationId,
  ])

  // 持久化助手回复到数据库
  useEffect(() => {
    const lastMessage = messages.at(-1)

    if (!lastMessage || lastMessage.role !== "assistant") {
      return
    }

    const text = getTextFromUIMessage(lastMessage).trim()

    if (!text || text === lastPersistedAssistantTextRef.current) {
      return
    }

    if (
      status !== "ready" ||
      !selectedConversationId ||
      !selectedContactId ||
      pendingAssistantPersistenceConversationId !== selectedConversationId
    ) {
      return
    }

    lastPersistedAssistantTextRef.current = text
    void persistAssistantMessageMutation.mutateAsync({
      conversationId: selectedConversationId,
      contactId: selectedContactId,
      text,
    })
    setPendingAssistantPersistenceConversationId(null)
  }, [
    messages,
    pendingAssistantPersistenceConversationId,
    persistAssistantMessageMutation,
    selectedContactId,
    selectedConversationId,
    status,
  ])

  // 计算各种状态
  const isDraftMode =
    Boolean(selectedContactId) &&
    (isDraftConversation || selectedConversationId == null) // 是否为草稿模式
  const isBusy =
    createConversationMutation.isPending ||
    persistUserMessageMutation.isPending ||
    status === "submitted" ||
    status === "streaming" // 是否忙碌状态
  const chatStatus = status === "ready" && isBusy ? "submitted" : status // 聊天状态

  // 处理输入变化的回调
  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setInputValue(event.value)
  }, [])

  // 格式化时间的回调
  const formatTime = useCallback((date: Date) => {
    return format(date, "HH:mm", { locale: zhCN })
  }, [])

  // 判断提交按钮是否禁用
  const isSubmitDisabled = useMemo(() => {
    return !(inputValue.trim() || status) || status === "streaming" || isBusy
  }, [inputValue, isBusy, status])

  // 发送消息的回调函数
  const handleSendMessage = useCallback(
    async (message: PromptInputMessage) => {
      // 检查是否有文本或附件
      const hasText = Boolean(message.text)
      const hasAttachments = Boolean(message.files?.length)
      const messageText = message.text?.trim() ?? ""

      // 检查是否有图片附件
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

      // 不支持图片输入
      if (hasImageAttachment) {
        toast.error("当前模型不支持图片输入，请移除图片后再发送")
        return
      }

      // 暂不支持仅发送附件
      if (!messageText) {
        toast.error("暂不支持仅发送附件")
        return
      }

      // 必须先选择联系人
      if (!selectedContactId) {
        toast.error("请先选择联系人")
        return
      }

      // 显示附件数量提示
      if (message.files?.length) {
        toast.success("Files attached", {
          description: `${message.files.length} file(s) attached to message`,
        })
      }

      try {
        let conversationId = selectedConversationId

        // 如果没有对话ID，创建新对话
        if (!conversationId) {
          const createdConversation =
            await createConversationMutation.mutateAsync({
              contactId: selectedContactId,
              title: messageText,
            })

          conversationId = createdConversation.id
          setDraftConversation(false)
          setSelectedConversationId(conversationId)
        }

        // 持久化用户消息
        await persistUserMessageMutation.mutateAsync({
          conversationId,
          contactId: selectedContactId,
          text: messageText,
        })

        setInputValue("")
        lastPersistedAssistantTextRef.current = ""

        // 如果是新对话，设置待处理的首条消息
        if (!selectedConversationId) {
          setPendingFirstMessage({
            conversationId,
            text: messageText,
          })
          return
        }

        // 发送消息
        setPendingAssistantPersistenceConversationId(conversationId)
        await sendMessage({
          text: messageText,
        })
      } catch (sendError) {
        toast.error("发送失败", {
          description:
            sendError instanceof Error ? sendError.message : "请稍后重试",
        })
      }
    },
    [
      createConversationMutation,
      setPendingAssistantPersistenceConversationId,
      selectedConversationId,
      setPendingFirstMessage,
      persistUserMessageMutation,
      selectedContactId,
      sendMessage,
      setDraftConversation,
      setSelectedConversationId,
    ]
  )

  // 渲染消息列表的备忘录
  const renderedMessages = useMemo(() => {
    if (messages.length > 0) {
      return messages
    }

    return initialMessages
  }, [initialMessages, messages])

  // 显示的消息列表
  const displayMessages = isDraftMode ? EMPTY_MESSAGES : renderedMessages
  // 是否显示流式指示器
  const showStreamingIndicator =
    !isDraftMode &&
    (status === "submitted" || status === "streaming") &&
    !error &&
    displayMessages.length > 0

  return (
    <div
      className={cn("flex flex-1 flex-col bg-background", className)}
      {...props}
    >
      {contact && (
        <>
          {/* 对话头部 */}
          <div className="flex items-center justify-between border-b px-6 py-3">
            <div className="flex items-center gap-3">
              {/* 联系人和对话切换按钮 */}
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
              {/* 对话标题 */}
              <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
                {conversationForTitle?.title ?? "新对话"}
              </h3>
            </div>
            {/* 更多选项按钮 */}
            <Button variant="ghost" size="icon-sm">
              <IconDots className="size-4" />
            </Button>
          </div>

          {/* 消息容器 */}
          <Conversation className="min-h-0 flex-1 overflow-y-auto pt-4">
            <ConversationContent>
              {/* 根据不同状态显示不同的内容 */}
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
                    ? storedMessage?.metadata
                    : null
                  const artifact = metadata?.artifact ?? null

                  return (
                    <Message key={message.id} from={message.role} className="">
                      {/* 助手消息显示发送者头像和名称 */}
                      {message.role === "assistant" && contact && (
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
                      {/* 显示时间戳 */}
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
                      {/* 工件预览 */}
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
              {/* 流式加载指示器 */}
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

          {/* 输入区域 */}
          <div className="border-t p-4">
            <ChatPromptInput
              value={inputValue}
              onChange={handleTextChange}
              onSubmit={handleSendMessage}
              status={chatStatus}
              disabled={isSubmitDisabled}
              size="compact"
              className="w-full overflow-hidden"
            />
            {/* 错误消息显示 */}
            {error && (
              <p className="mt-2 text-xs text-destructive">{error.message}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
