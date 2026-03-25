import * as React from "react"

import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { ContactsSidebar } from "./contacts-sidebar"
import { ConversationList } from "./conversation-list"
import { ChatView } from "./chat-view"

export function ChatLayout({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [showContacts, setShowContacts] = React.useState(false)
  const [showConversations, setShowConversations] = React.useState(false)
  const isMobile = useIsMobile()

  return (
    <div className={cn("relative flex h-full", className)} {...props}>
      {isMobile ? (
        <>
          <div className="flex h-full flex-1">
            <ChatView
              onOpenContacts={() => setShowContacts(true)}
              onOpenConversations={() => setShowConversations(true)}
            />
          </div>

          <Sheet open={showContacts} onOpenChange={setShowContacts}>
            <SheetContent side="left" className="w-64 p-0">
              <ContactsSidebar />
            </SheetContent>
          </Sheet>

          <Sheet open={showConversations} onOpenChange={setShowConversations}>
            <SheetContent side="left" className="w-64 p-0">
              <ConversationList />
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <>
          <ContactsSidebar />
          <ConversationList />
          <ChatView />
        </>
      )}
    </div>
  )
}
