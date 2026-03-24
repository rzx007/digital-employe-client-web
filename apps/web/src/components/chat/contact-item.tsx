"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import type { Contact } from "@/lib/mock-data/ai-employees"
import {
  EmployeeContactAvatar,
  GroupMembersAvatar,
} from "./contact-avatars"
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
        <GroupMembersAvatar
          participants={contact.group?.participants}
          className="h-10 w-10 gap-1"
          itemClassName="h-[18px] w-[18px]"
          fallbackClassName="text-[10px]"
          placeholderClassName="h-[18px] w-[18px]"
        />
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
        <EmployeeContactAvatar
          name={contact.employee?.name}
          avatar={contact.employee?.avatar}
          status={contact.employee?.status}
          showStatus
          avatarClassName="h-10 w-10"
          statusClassName="h-2.5 w-2.5"
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
