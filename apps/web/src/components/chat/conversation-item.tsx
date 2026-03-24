"use client"

import * as React from "react"

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { Conversation } from "@/lib/mock-data/conversations"
import { getContactById } from "@/lib/mock-data/ai-employees"

interface ConversationItemProps extends React.ComponentProps<"div"> {
  conversation: Conversation
  isSelected: boolean
}

export function ConversationItem({
  conversation,
  isSelected,
  className,
  ...props
}: ConversationItemProps) {
  const contact = getContactById(conversation.contactId)
  const getTimeAgo = (date?: Date) => {
    if (!date) return ""
    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: zhCN,
    })
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2.5 text-xs transition-colors",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 hover:text-accent-foreground",
        className
      )}
      {...props}
    >
      <div className="relative shrink-0">
        {contact?.type === "group" ? (
          <AvatarGroup className="-space-x-2">
            {contact.group?.participants.slice(0, 3).map((p) => (
              <Avatar
                key={p.id}
                className="h-10 w-10 border-2 border-background"
              >
                <AvatarFallback className="bg-primary text-[10px] font-medium text-primary-foreground">
                  {p.name.slice(0, 1)}
                </AvatarFallback>
              </Avatar>
            ))}
          </AvatarGroup>
        ) : (
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary font-medium text-primary-foreground">
              {contact?.employee?.name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span className="truncate font-medium">
            {contact?.type === "group"
              ? contact.group?.name
              : contact?.employee?.name}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {getTimeAgo(conversation.lastMessageTime)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-muted-foreground">
            {conversation.lastMessage}
          </span>
          {conversation.unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="h-4 min-w-[1.25rem] rounded-full px-1.5 text-[10px] font-medium"
            >
              {conversation.unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}
