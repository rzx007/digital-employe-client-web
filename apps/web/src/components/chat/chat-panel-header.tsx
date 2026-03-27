import * as React from "react"

import {
  IconArchive,
  IconDots,
  IconMessages,
  IconPencil,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { useIsMobile } from "@/hooks/use-mobile"

interface ChatPanelHeaderProps {
  title: string
  onOpenContacts?: () => void
  onOpenConversations?: () => void
}

export function ChatPanelHeader({
  title,
  onOpenContacts,
  onOpenConversations,
}: ChatPanelHeaderProps) {
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = React.useState(false)

  return (
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
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
      </div>
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
          <DropdownMenuItem variant="destructive">
            <IconTrash />
            <span>删除</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
