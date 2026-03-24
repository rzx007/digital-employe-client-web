import * as React from "react"

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  IconPlus,
  IconSettings,
  IconSearch,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { CONTACTS, type AIEmployee } from "@/lib/mock-data/ai-employees"

import { CreateGroupDialog } from "./create-group-dialog"
import { useChatContext } from "./chat-context"

export function ContactsSidebar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [isCollapsed, setIsCollapsed] = React.useState(false)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const { selectedContactId, setSelectedContactId } = useChatContext()

  const handleCreateGroup = (selectedEmployees: AIEmployee[]) => {
    console.log("创建群聊，选择员工:", selectedEmployees)
    setIsDialogOpen(false)
  }

  return (
    <>
      <CreateGroupDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onCreate={handleCreateGroup}
      />
      <div
        className={cn(
          "flex flex-col border-r bg-muted/50 transition-all duration-300",
          isCollapsed ? "w-14" : "w-64",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "flex items-center border-b p-4",
            isCollapsed ? "flex-col space-y-4" : "justify-between"
          )}
        >
          {!isCollapsed && (
            <span className="text-lg font-semibold">Contacts</span>
          )}
          <div
            className={cn(
              "flex items-center",
              isCollapsed ? "w-full flex-col space-y-4" : ""
            )}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              title="搜索"
            >
              <IconSearch className="size-4" />
            </Button>
            <Button
              onClick={() => setIsDialogOpen(true)}
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              title="新建群聊"
            >
              <IconPlus className="size-4" />
            </Button>
          </div>
        </div>

        <div className={cn("flex-1 overflow-y-auto", isCollapsed && "py-2")}>
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-3 px-2">
              {CONTACTS.map((contact) => {
                const contactId =
                  contact.type === "employee"
                    ? contact.employee?.id
                    : contact.group?.id
                const isSelected = selectedContactId === contactId
                return (
                  <div
                    key={contactId}
                    onClick={() => setSelectedContactId?.(contactId || null)}
                    className={cn(
                      "relative cursor-pointer transition-transform hover:scale-110",
                      isSelected &&
                      "rounded-md ring-2 ring-ring ring-offset-2 ring-offset-background"
                    )}
                  >
                    {contact.type === "group" ? (
                      <div className="flex -space-x-1">
                        {contact.group?.participants.slice(0, 1).map((p) => (
                          <Avatar
                            key={p.id}
                            className="h-8 w-8 border-2 border-background rounded-none"
                          >
                            <AvatarFallback className="rounded-none! bg-primary text-[10px] font-medium text-primary-foreground">
                              {p.name.slice(0, 1)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                    ) : (
                      <>
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="rounded-none! bg-primary font-medium text-primary-foreground">
                            {contact.employee?.name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                        <Badge
                          className={cn(
                            "absolute right-0 bottom-0 h-2 w-2 rounded-full border-2 border-background p-0",
                            contact.employee?.status === "online" &&
                            "bg-green-500",
                            contact.employee?.status === "busy" && "bg-red-500",
                            contact.employee?.status === "offline" &&
                            "bg-gray-400"
                          )}
                        />
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-0.5 px-2 py-2">
              {CONTACTS.map((contact) => {
                const contactId =
                  contact.type === "employee"
                    ? contact.employee?.id
                    : contact.group?.id
                const isSelected = selectedContactId === contactId
                return (
                  <div
                    key={contactId}
                    onClick={() => setSelectedContactId?.(contactId || null)}
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-md p-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-accent text-accent-foreground"
                    )}
                  >
                    {contact.type === "group" ? (
                      <>
                        <AvatarGroup className="-space-x-1">
                          {contact.group?.participants.slice(0, 2).map((p) => (
                            <Avatar
                              key={p.id}
                              className="rounded-none! h-8 w-8 border-2 border-background"
                            >
                              <AvatarFallback className="rounded-none! bg-primary text-[10px] font-medium text-primary-foreground">
                                {p.name.slice(0, 1)}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                        </AvatarGroup>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-medium">
                            {contact.group?.name}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {contact.group?.participants.length} 位成员
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="relative">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="rounded-none! bg-primary font-medium text-primary-foreground">
                              {contact.employee?.name.slice(0, 1)}
                            </AvatarFallback>
                          </Avatar>
                          <Badge
                            className={cn(
                              "absolute right-0 bottom-0 h-2 w-2 rounded-full border-2 border-background p-0",
                              contact.employee?.status === "online" &&
                              "bg-green-500",
                              contact.employee?.status === "busy" &&
                              "bg-red-500",
                              contact.employee?.status === "offline" &&
                              "bg-gray-400"
                            )}
                          />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-medium">
                            {contact.employee?.name}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {contact.employee?.role}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex border-t p-4",
            isCollapsed
              ? "flex-col items-center gap-2"
              : "items-center justify-between"
          )}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            title="设置"
          >
            <IconSettings className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "展开" : "折叠"}
          >
            {isCollapsed ? (
              <IconChevronRight className="size-4" />
            ) : (
              <IconChevronLeft className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </>
  )
}
