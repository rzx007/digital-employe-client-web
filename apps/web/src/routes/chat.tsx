import { createFileRoute } from "@tanstack/react-router"
import { ChatLayout } from "@/components/chat/chat-layout"

export const Route = createFileRoute("/chat")({
  component: ChatPage,
})

function ChatPage() {
  return (
    <div className="h-[calc(100vh-4rem)]">
      <ChatLayout />
    </div>
  )
}
