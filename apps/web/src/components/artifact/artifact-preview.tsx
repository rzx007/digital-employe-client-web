

import { motion } from "motion/react"
import {
  IconArrowDown,
  IconFileCode,
  IconFileText,
  IconMagnet,
  IconTable,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "./artifact-types"
import { Button } from "@workspace/ui/components/button"
import type { ComponentType } from "react"

export interface ArtifactPreviewProps {
  artifact: Artifact
  onClick: () => void
  className?: string
}

const typeIcons: Record<Artifact["type"], ComponentType<any>> = {
  text: IconFileText,
  code: IconFileCode,
  sheet: IconTable,
  image: IconMagnet,
}

const typeLabels: Record<Artifact["type"], string> = {
  text: "文本",
  code: "代码",
  sheet: "表格",
  image: "图像",
}

export const ArtifactPreview = ({
  artifact,
  onClick,
  className,
  ...props
}: ArtifactPreviewProps) => {
  const Icon = typeIcons[artifact.type]

  return (
    <motion.div
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-background p-5 transition-colors hover:shadow-md overflow-hidden max-w-90 relative",
        className
      )}
      {...props}
    >
      <img src='/doc-grid.png' alt={artifact.title} width={120} height={110} className="absolute top-1 -left-1" />
      <div className="space-y-2 mr-32">
        <Icon className="h-5 w-5 text-primary/70" />
        <div className="flex flex-col gap-1">
          <p className="text-base text-secondary-foreground/75">{artifact.title}</p>
          <p className="text-xs font-thin text-muted-foreground">
            {typeLabels[artifact.type]}
          </p>
        </div>
      </div>
      <div className="h-35 absolute -right-1 top-6 w-34 rounded-xl shadow-md bg-background border border-border/60 transition-transform group-hover:-rotate-5">
        <img src='/doc-canvas-card-fallback.png' alt={artifact.title} width={100} height={100} className="object-cover w-full h-full" />
      </div>
      <Button size="icon" variant="outline" className="size-8 p-0 absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconArrowDown className="size-4" />
      </Button>
    </motion.div>
  )
}
