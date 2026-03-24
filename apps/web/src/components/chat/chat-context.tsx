

import * as React from "react"

const chatContext = React.createContext<{
  selectedConversationId: string | null
  setSelectedConversationId: (id: string | null) => void
  selectedContactId: string | null
  setSelectedContactId: (id: string | null) => void
} | null>(null)

export function useChatContext() {
  const context = React.useContext(chatContext)
  if (!context) {
    throw new Error("useChatContext must be used within ChatLayout")
  }
  return context
}

export { chatContext }
