"use client"

import * as React from "react"

import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { CONVERSATIONS } from "@/lib/mock-data/conversations"
import { getConversationsByContactId } from "@/lib/mock-data/conversations"

import { ConversationItem } from "./conversation-item"
import { useChatContext } from "./chat-context"

export function ConversationList({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const {
    selectedConversationId,
    setSelectedConversationId,
    selectedContactId,
  } = useChatContext()

  const conversations = React.useMemo(() => {
    if (selectedContactId) {
      return getConversationsByContactId(selectedContactId)
    }
    return CONVERSATIONS
  }, [selectedContactId])

  return (
    <div
      className={cn("flex w-[320px] flex-col border-r bg-muted/50", className)}
      {...props}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">
          {selectedContactId ? "会话记录" : "最近消息"}
        </h2>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md border border-input bg-background text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            if (setSelectedConversationId) {
              setSelectedConversationId(null)
            }
          }}
        >
          +
        </button>
      </div>

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
