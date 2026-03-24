import * as React from "react"

import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { CONVERSATIONS } from "@/lib/mock-data/conversations"
import { getConversationsByContactId } from "@/lib/mock-data/conversations"
import { getContactById } from "@/lib/mock-data/ai-employees"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { Button } from "@workspace/ui/components/button"
import { IconCirclePlus } from "@tabler/icons-react"

import { ConversationItem } from "./conversation-item"
import { useChatContext } from "./chat-context"
import { useIsMobile } from "@/hooks/use-mobile"

export function ConversationList({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const {
    selectedConversationId,
    setSelectedConversationId,
    selectedContactId,
  } = useChatContext()
  const isMobile = useIsMobile()
  const conversations = React.useMemo(() => {
    if (selectedContactId) {
      return getConversationsByContactId(selectedContactId)
    }
    return CONVERSATIONS
  }, [selectedContactId])

  React.useEffect(() => {
    if (!setSelectedConversationId || conversations.length === 0) return

    const hasSelected = conversations.some(
      (conversation) => conversation.id === selectedConversationId
    )

    if (!hasSelected) {
      setSelectedConversationId(conversations[0].id)
    }
  }, [conversations, selectedConversationId, setSelectedConversationId])

  const selectedContact = React.useMemo(() => {
    if (!selectedContactId) return null
    return getContactById(selectedContactId) ?? null
  }, [selectedContactId])

  return (
    <div
      className={cn(
        "flex flex-col border-r bg-muted/50",
        isMobile ? "h-full w-full" : "w-[320px]",
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
                  : selectedContact.employee?.name}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {selectedContact.type === "group"
                  ? `${selectedContact.group?.participants.length ?? 0} 位成员`
                  : selectedContact.employee?.role}
              </p>
            </div>
          </div>
        ) : (
          <h2 className="text-sm font-medium">最近消息</h2>
        )}
        {/* <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            if (setSelectedConversationId) {
              setSelectedConversationId(null)
            }
          }}
        >
          <IconCirclePlus className="size-4" />
        </Button> */}
      </div>
      <Button
        className="m-2"
        variant="outline"
        onClick={() => {
          if (setSelectedConversationId) {
            setSelectedConversationId(null)
          }
        }}
      >
          <IconCirclePlus className="size-4" />新建会话
      </Button>

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isSelected={selectedConversationId === conversation.id}
              onClick={() => setSelectedConversationId?.(conversation.id)}
            />
          ))}
          {conversations.length === 0 && (
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
