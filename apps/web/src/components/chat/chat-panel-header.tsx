import * as React from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"

import {
  IconCalendar,
  IconArchive,
  IconDots,
  IconMessages,
  IconPencil,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { useDeleteConversationMutation } from "@/hooks/use-chat-queries"
import { useIsMobile } from "@/hooks/use-mobile"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import type { ChatViewContact } from "./chat-view-shared"

interface ChatPanelHeaderProps {
  title: string
  conversationId?: string | number
  contact?: ChatViewContact
  onOpenContacts?: () => void
  onOpenConversations?: () => void
}

export function ChatPanelHeader({
  title,
  conversationId,
  contact,
  onOpenContacts,
  onOpenConversations,
}: ChatPanelHeaderProps) {
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [alertOpen, setAlertOpen] = React.useState(false)
  const { selectedContactId, setSelectedConversationId, setDraftConversation } =
    useChatStore(
      useShallow((state) => ({
        selectedContactId: state.selectedContactId,
        setSelectedConversationId: state.setSelectedConversationId,
        setDraftConversation: state.setDraftConversation,
      }))
    )
  const deleteMutation = useDeleteConversationMutation()
  const openMonitor = useMonitorStore((s) => s.openMonitor)

  const handleDeleteClick = () => {
    setMenuOpen(false)
    setAlertOpen(true)
  }

  const handleDeleteConfirm = () => {
    setAlertOpen(false)

    if (!selectedContactId || !conversationId) return

    deleteMutation.mutate(
      {
        conversationId: String(conversationId),
        contactId: selectedContactId,
      },
      {
        onSuccess: () => {
          toast.success(`已删除「${title}」`)
          setSelectedConversationId(null)
          setDraftConversation(true)
        },
        onError: () => {
          toast.error("删除失败，请稍后重试")
        },
      }
    )
  }

  return (
    <>
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          {isMobile && (
            <>
              {onOpenContacts && (
                <Button variant="ghost" size="icon-sm" onClick={onOpenContacts}>
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
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </h3>
        </div>
        {conversationId && (
          <div className="flex items-center gap-1">
            {contact?.type === "employee" && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openMonitor(contact.employee?.id ?? "")}
              >
                <IconCalendar className="size-4" />
              </Button>
            )}
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <IconDots className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem>
                  <IconPencil className="text-muted-foreground" />
                  <span>重命名</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <IconArchive className="text-muted-foreground" />
                  <span>归档</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={handleDeleteClick}
                >
                  <IconTrash />
                  <span>删除</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{title}」吗？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}