import { useEffect, type ComponentProps } from "react"
import { IconCirclePlus } from "@tabler/icons-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useIsMobile } from "@/hooks/use-mobile"
import { useChatStore } from "@/stores/chat-store"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { ConversationItem } from "./conversation-item"

export function ConversationList({
  className,
  ...props
}: ComponentProps<"div">) {
  const {
    selectedContactId,
    selectedConversationId,
    isDraftConversation,
    setDraftConversation,
    setSelectedConversationId,
  } = useChatStore(
    useShallow((state) => ({
      selectedContactId: state.selectedContactId,
      selectedConversationId: state.selectedConversationId,
      isDraftConversation: state.isDraftConversation,
      setDraftConversation: state.setDraftConversation,
      setSelectedConversationId: state.setSelectedConversationId,
    }))
  )
  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const isMobile = useIsMobile()
  const {
    data: conversations = [],
    isSuccess: conversationsQuerySuccess,
    isPending: conversationsPending,
  } = useConversationsQuery(selectedContactId, selectedContact)

  useEffect(() => {
    if (!selectedContactId) return

    if (!conversationsQuerySuccess) return

    if (conversations.length === 0) {
      if (selectedConversationId != null) {
        setSelectedConversationId(null)
        return
      }

      if (!isDraftConversation) {
        setDraftConversation(true)
      }
      return
    }

    if (isDraftConversation) {
      return
    }

    const hasSelected = conversations.some(
      (conversation) =>
        String(conversation.id) === String(selectedConversationId)
    )
    if (!hasSelected) {
      setSelectedConversationId(conversations[0].id)
    }
  }, [
    conversations,
    conversationsQuerySuccess,
    isDraftConversation,
    selectedContactId,
    selectedConversationId,
    setDraftConversation,
    setSelectedConversationId,
  ])

  return (
    <div
      className={cn(
        "flex flex-col border-r bg-muted/50 transition-all duration-300",
        isMobile ? "h-full w-full" : "w-[245px] xl:w-[295px]",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        {selectedContact ? (
          <div className="flex min-w-0 items-center gap-2">
            {selectedContact.type === "group" ? (
              <GroupMembersAvatar
                participants={selectedContact.group?.participants}
                className="h-8 w-8"
              />
            ) : selectedContact.type === "curator" ? (
              <EmployeeContactAvatar
                name={selectedContact.curator?.name}
                avatar={selectedContact.curator?.avatar}
                status={selectedContact.curator?.status}
                showStatus
              />
            ) : (
              <EmployeeContactAvatar
                name={selectedContact.employee?.name}
                avatar={selectedContact.employee?.avatar}
                status={selectedContact.employee?.status}
                showStatus
              />
            )}
            <div className="flex min-w-0 flex-col">
              <h2 className="truncate text-sm font-medium">
                {selectedContact.type === "group"
                  ? selectedContact.group?.name
                  : selectedContact.type === "curator"
                    ? selectedContact.curator?.name
                    : selectedContact.employee?.name}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {selectedContact.type === "group"
                  ? `${selectedContact.group?.participants.length ?? 0} 位成员`
                  : selectedContact.type === "curator"
                    ? selectedContact.curator?.role
                    : selectedContact.employee?.role}
              </p>
            </div>
          </div>
        ) : (
          <h2 className="text-sm font-medium">最近消息</h2>
        )}
      </div>

      <Button
        className="m-2"
        variant="outline"
        onClick={() => {
          setDraftConversation(true)
          setSelectedConversationId(null)
        }}
      >
        <IconCirclePlus className="size-4" />
        新建会话
      </Button>

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {selectedContactId && conversationsPending && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              加载会话…
            </div>
          )}
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isSelected={
                String(selectedConversationId) === String(conversation.id)
              }
              onClick={() => {
                setDraftConversation(false)
                setSelectedConversationId(conversation.id)
              }}
            />
          ))}
          {selectedContactId &&
            !conversationsPending &&
            conversations.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <p className="text-xs">暂无会话记录</p>
                <p className="mt-1 text-xs">选择联系人开始聊天</p>
              </div>
            )}
        </div>
      </ScrollArea>
    </div>
  )
}
