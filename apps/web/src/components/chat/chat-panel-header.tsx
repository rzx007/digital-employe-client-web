import { IconDots, IconMessages, IconUsers } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"

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
      <Button variant="ghost" size="icon-sm">
        <IconDots className="size-4" />
      </Button>
    </div>
  )
}
