import * as React from "react"
import type { UIMessage } from "ai"

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation"
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool"
import { cn } from "@workspace/ui/lib/utils"
import { IconSparkles, IconSquareRoundedX } from "@tabler/icons-react"
import logo from "@/assets/logo.svg"
import {
  getLatestArtifactFromUIMessage,
  getRenderBlocksFromUIMessage,
} from "@/lib/chat/message-utils"
import { Spinner } from "@/components/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { useEmployeeSkillsQuery } from "@/hooks/use-chat-queries"
import { useArtifactStore } from "@/stores/artifact-store"
import { useChatStore } from "@/stores/chat-store"

import { ArtifactPreview } from "../artifact"
import { ChatPromptInput } from "../chat-prompt-input"
import type { PromptChangeEvent } from "../lexical-editor/prompt-input-textarea"
import type { SlashCommandItem } from "../lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "../lexical-editor/mention-plugin"
import { ChatPanelHeader } from "./chat-panel-header"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { getContactDisplayName, type ChatViewContact } from "./chat-view-shared"

const EMPTY_MESSAGES: UIMessage[] = []

type ToolUIPart = Extract<
  UIMessage["parts"][number],
  {
    type: `tool-${string}` | "dynamic-tool"
    toolCallId: string
  }
>

function renderToolOutput(output: unknown) {
  if (output == null) {
    return null
  }

  const content =
    typeof output === "object"
      ? JSON.stringify(output, null, 2)
      : String(output)

  return <MessageResponse>{content}</MessageResponse>
}

export function ChatPanel({
  contact,
  title,
  conversationId,
  messages,
  inputValue,
  status,
  error,
  isDraftMode,
  isSubmitDisabled,
  onInputChange,
  onSend,
  onStopStream,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  title: string
  conversationId?: string | number
  messages: UIMessage[]
  inputValue: string
  status: "submitted" | "streaming" | "ready" | "error"
  error?: Error
  isDraftMode: boolean
  isSubmitDisabled: boolean
  onInputChange: (event: PromptChangeEvent) => void
  onSend: (message: PromptInputMessage) => Promise<void>
  onStopStream?: () => void
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const isMobile = useIsMobile()
  const { addArtifact, openArtifact, setFullscreen } = useArtifactStore()

  const contactDisplayName = contact
    ? getContactDisplayName(contact)
    : "AI 助手"

  const displayMessages = isDraftMode ? EMPTY_MESSAGES : messages
  const showStreamingIndicator =
    !isDraftMode &&
    (status === "submitted" || status === "streaming") &&
    !error &&
    displayMessages.length > 0

  React.useEffect(() => {
    displayMessages.forEach((message) => {
      const artifact = getLatestArtifactFromUIMessage(message)

      if (artifact) {
        addArtifact(artifact)
      }
    })
  }, [addArtifact, displayMessages])

  const employeeId =
    contact?.type === "employee" ? (contact.employee?.id ?? null) : null
  const { data: agentSkills } = useEmployeeSkillsQuery(employeeId)

  const slashCommands = React.useMemo<SlashCommandItem[]>(() => {
    if (agentSkills?.length) {
      return agentSkills.map((skill) => ({
        id: skill.name,
        title: skill.name,
        icon: <IconSparkles className="h-4 w-4" />,
        description: skill.description,
        keywords: [
          skill.name.toLowerCase(),
          ...skill.description.toLowerCase().split(/\s+/).slice(0, 3),
        ],
      }))
    }

    const metadataSkills =
      contact?.type === "employee" ? contact.employee?.skills : undefined
    if (!metadataSkills?.length) return []
    return metadataSkills.map((skill) => ({
      id: String(skill.id),
      title: skill.skillName,
      icon: <IconSparkles className="h-4 w-4" />,
      description: skill.description,
      keywords: [
        skill.skillName.toLowerCase(),
        ...skill.description.toLowerCase().split(/\s+/).slice(0, 3),
      ],
    }))
  }, [contact, agentSkills])

  const mentionCandidates = React.useMemo<MentionCandidate[]>(() => {
    if (contact?.type === "group") {
      return (contact.group?.participants ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        role: p.role,
      }))
    }
    if (contact?.type === "curator") {
      const { contacts } = useChatStore.getState()
      return contacts
        .filter((c) => c.type === "employee" && c.employee)
        .map((c) => ({
          id: c.employee!.id,
          name: c.employee!.name,
          avatar: c.employee!.avatar,
          role: c.employee!.role,
        }))
    }
    return []
  }, [contact])

  return (
    <div
      className={cn("flex flex-1 flex-col bg-background", className)}
      {...props}
    >
      {contact && (
        <>
          <ChatPanelHeader
            title={title}
            conversationId={conversationId}
            contact={contact}
            onOpenContacts={onOpenContacts}
            onOpenConversations={onOpenConversations}
            onNewConversation={onNewConversation}
          />
          <Conversation className="min-h-0 flex-1 overflow-y-auto pt-4">
            <ConversationContent>
              {isDraftMode ? (
                <ConversationEmptyState className="py-16">
                  <div className="flex flex-col items-center gap-6">
                    <img src={logo} alt="Logo" className="size-12 opacity-80" />
                    <div className="space-y-3 text-center">
                      <h2 className="text-md font-semibold tracking-tight">
                        数字员工智能助手
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        随时为您解答问题、处理任务、提升效率
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      {["智能问答", "数据分析", "文档生成", "流程自动化"].map(
                        (label) => (
                          <span
                            key={label}
                            className="rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-xs text-muted-foreground"
                          >
                            {label}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </ConversationEmptyState>
              ) : displayMessages.length === 0 ? (
                <ConversationEmptyState className="py-16">
                  <div className="flex flex-col items-center gap-5">
                    <img
                      src={logo}
                      alt="Logo"
                      className="h-10 w-10 opacity-50"
                    />
                    <div className="space-y-1.5 text-center">
                      <h3 className="text-sm font-medium">开始新对话</h3>
                      <p className="text-xs text-muted-foreground">
                        在下方输入消息，开启与 {contactDisplayName} 的对话
                      </p>
                    </div>
                  </div>
                </ConversationEmptyState>
              ) : (
                displayMessages.map((message) => {
                  const artifact = getLatestArtifactFromUIMessage(message)
                  const renderBlocks = getRenderBlocksFromUIMessage(message)

                  const handleOpenArtifact = () => {
                    if (!artifact) {
                      return
                    }

                    addArtifact(artifact)
                    setFullscreen(isMobile)
                    openArtifact(artifact.id)
                  }

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
                        <div className="space-y-3">
                          {renderBlocks.length > 0 ? (
                            renderBlocks.map((block) => {
                              if (block.kind === "text") {
                                return (
                                  <MessageResponse key={block.key}>
                                    {block.text}
                                  </MessageResponse>
                                )
                              }

                              if (block.kind === "tool") {
                                const part = block.part as ToolUIPart
                                const headerProps =
                                  part.type === "dynamic-tool" &&
                                  "toolName" in part
                                    ? {
                                        type: part.type,
                                        state: part.state,
                                        toolName: part.toolName as string,
                                      }
                                    : { type: part.type, state: part.state }

                                return (
                                  <Tool
                                    key={block.key}
                                    className="max-w-2xl"
                                    defaultOpen={false}
                                  >
                                    <ToolHeader {...headerProps} />
                                    <ToolContent>
                                      <ToolInput input={part.input} />
                                      <ToolOutput
                                        errorText={part.errorText}
                                        output={renderToolOutput(part.output)}
                                      />
                                    </ToolContent>
                                  </Tool>
                                )
                              }

                              return (
                                <ArtifactPreview
                                  key={block.key}
                                  artifact={block.artifact}
                                  onClick={() => {
                                    addArtifact(block.artifact)
                                    setFullscreen(isMobile)
                                    openArtifact(block.artifact.id)
                                  }}
                                />
                              )
                            })
                          ) : renderBlocks.length === 0 ? null : (
                            <MessageResponse />
                          )}
                        </div>
                      </MessageContent>
                      {artifact && renderBlocks.length === 0 && (
                        <ArtifactPreview
                          artifact={artifact}
                          onClick={handleOpenArtifact}
                        />
                      )}
                    </Message>
                  )
                })
              )}

              {showStreamingIndicator && (
                <Message from="assistant" className="-mt-4">
                  <MessageContent className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Spinner
                        className="size-3.5"
                        style={{ color: "#8B5CF6" }}
                      />
                      <Shimmer className="text-xs">正在生成回复...</Shimmer>
                      {onStopStream && (
                        <button
                          type="button"
                          onClick={onStopStream}
                          className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
                        >
                          <IconSquareRoundedX className="size-4" />
                        </button>
                      )}
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
              slashCommands={slashCommands}
              mentionCandidates={mentionCandidates}
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
