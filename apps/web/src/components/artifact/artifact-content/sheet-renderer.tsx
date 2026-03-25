import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "../artifact-types"

export interface SheetRendererProps {
  artifact: Artifact
  className?: string
}

export const SheetRenderer = ({ artifact, className }: SheetRendererProps) => {
  return (
    <div className={cn("flex-1 overflow-auto p-4", className)}>
      <MessageResponse>{artifact.content}</MessageResponse>
    </div>
  )
}
