"use client"

import * as React from "react"

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import type { Contact } from "@/lib/mock-data/ai-employees"
import { useChatContext } from "./chat-context"

interface ContactItemProps extends React.ComponentProps<"div"> {
  contact: Contact
  isCollapsed: boolean
}

export function ContactItem({
  contact,
  isCollapsed,
  className,
  ...props
}: ContactItemProps) {
  const { selectedContactId, setSelectedContactId } = useChatContext()
  const contactId =
    contact.type === "employee" ? contact.employee?.id : contact.group?.id
  const isSelected = selectedContactId === contactId

  const handleClick = () => {
    setSelectedContactId?.(contactId || null)
  }

  if (contact.type === "group") {
    return (
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground",
          isSelected && "bg-accent text-accent-foreground",
          className
        )}
        {...props}
        onClick={handleClick}
      >
        <AvatarGroup className="-space-x-2">
          {contact.group?.participants.slice(0, 3).map((p) => (
            <Avatar key={p.id} className="h-10 w-10 border-2 border-background">
              <AvatarFallback className="bg-primary font-medium text-primary-foreground">
                {p.name.slice(0, 1)}
              </AvatarFallback>
            </Avatar>
          ))}
        </AvatarGroup>
        {!isCollapsed && (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-medium">{contact.group?.name}</span>
            <span className="truncate text-muted-foreground">
              {contact.group?.participants.length} 位成员
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground",
        isSelected && "bg-accent text-accent-foreground",
        className
      )}
      {...props}
      onClick={handleClick}
    >
      <div className="relative shrink-0">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-primary font-medium text-primary-foreground">
            {contact.employee?.name.slice(0, 1)}
          </AvatarFallback>
        </Avatar>
        <Badge
          className={cn(
            "absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-background p-0",
            contact.employee?.status === "online" && "bg-green-500",
            contact.employee?.status === "busy" && "bg-red-500",
            contact.employee?.status === "offline" && "bg-gray-400"
          )}
        />
      </div>
      {!isCollapsed && (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{contact.employee?.name}</span>
          <span className="truncate text-muted-foreground">
            {contact.employee?.role}
          </span>
        </div>
      )}
    </div>
  )
}
