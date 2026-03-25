export const chatKeys = {
  all: ["chat"] as const,
  contacts: () => [...chatKeys.all, "contacts"] as const,
  conversations: (contactId: string) =>
    [...chatKeys.all, "conversations", contactId] as const,
  messages: (conversationId: string) =>
    [...chatKeys.all, "messages", conversationId] as const,
}
