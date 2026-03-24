import * as React from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@workspace/ui/components/button"
import {
  IconCirclePlus,
  IconSettings,
  IconSearch,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { CONTACTS, type AIEmployee } from "@/lib/mock-data/ai-employees"

import {
  EmployeeContactAvatar,
  GroupMembersAvatar,
} from "./contact-avatars"
import { CreateGroupDialog } from "./create-group-dialog"
import { useChatContext } from "./chat-context"

export function ContactsSidebar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [isCollapsed, setIsCollapsed] = React.useState(false)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const { selectedContactId, setSelectedContactId } = useChatContext()
  const isMobile = useIsMobile()
  const handleCreateGroup = (selectedEmployees: AIEmployee[]) => {
    console.log("创建群聊，选择员工:", selectedEmployees)
    setIsDialogOpen(false)
  }

  const groupContacts = React.useMemo(
    () => CONTACTS.filter((contact) => contact.type === "group"),
    []
  )
  const employeeContacts = React.useMemo(
    () => CONTACTS.filter((contact) => contact.type === "employee"),
    []
  )

  return (
    <>
      <CreateGroupDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onCreate={handleCreateGroup}
      />
      <div
        className={cn(
          "h-full flex flex-col border-r bg-muted/50 transition-all duration-300",
          isCollapsed ? "w-14" : isMobile ? "w-full" : "w-64",
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
            <span className="text-lg font-semibold">员工列表</span>
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
              <IconCirclePlus className="size-4" />
            </Button>
          </div>
        </div>

        <div className={cn("flex-1 overflow-y-auto", isCollapsed && "py-2")}>
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2 px-2">
              {groupContacts.map((contact) => {
                const contactId = contact.group?.id
                const isSelected = selectedContactId === contactId
                return (
                  <div
                    key={contactId}
                    onClick={() => setSelectedContactId?.(contactId || null)}
                    className={cn(
                      "relative cursor-pointer transition-transform hover:scale-105",
                      isSelected &&
                        "rounded-md ring-1 ring-ring ring-offset-1 ring-offset-primary"
                    )}
                  >
                    <GroupMembersAvatar
                      participants={contact.group?.participants}
                      className="h-8 w-8"
                    />
                  </div>
                )
              })}

              <div className="my-1 h-px w-7 bg-border" />

              {employeeContacts.map((contact) => {
                const contactId = contact.employee?.id
                const isSelected = selectedContactId === contactId
                return (
                  <div
                    key={contactId}
                    onClick={() => setSelectedContactId?.(contactId || null)}
                    className={cn(
                      "relative cursor-pointer transition-transform hover:scale-105",
                      isSelected &&
                        "rounded-md ring-1 ring-ring ring-offset-1 ring-offset-primary"
                    )}
                  >
                    <EmployeeContactAvatar
                      name={contact.employee?.name}
                      avatar={contact.employee?.avatar}
                      status={contact.employee?.status}
                      showStatus
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-3 px-2 py-2">
              <div className="space-y-0.5">
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  群聊
                </p>
                {groupContacts.map((contact) => {
                  const contactId = contact.group?.id
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
                      <GroupMembersAvatar
                        participants={contact.group?.participants}
                        className="size-9"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-medium">
                          {contact.group?.name}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {contact.group?.participants.length} 位成员
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="space-y-0.5">
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  联系人
                </p>
                {employeeContacts.map((contact) => {
                  const contactId = contact.employee?.id
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
                      <EmployeeContactAvatar
                        name={contact.employee?.name}
                        avatar={contact.employee?.avatar}
                        status={contact.employee?.status}
                        showStatus
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-medium">
                          {contact.employee?.name}
                        </span>
                        <span className="truncate text-muted-foreground" title={contact.employee?.role}>
                          {contact.employee?.role}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex border-t p-2",
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
