

import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "../artifact-types"

export interface CodeRendererProps {
  artifact: Artifact
  className?: string
}

export const CodeRenderer = ({ artifact, className }: CodeRendererProps) => {
  const language = artifact.language || "text"

  return (
    <div className={cn("flex-1 overflow-auto p-4", className)}>
      <MessageResponse>
        {`\`\`\`${language}\n${artifact.content}\n\`\`\``}
      </MessageResponse>
    </div>
  )
}
