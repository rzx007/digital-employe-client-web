import type { UIMessage } from "ai"

import type { Artifact, ArtifactType } from "@/types/artifact"

type ToolPart = Extract<UIMessage["parts"][number], { type: `tool-${string}` }>

interface ToolOutputPayload {
  input?: Record<string, unknown>
  inputText?: string
  text?: string
  toolName?: string | null
  status?: string | null
}

function getFileExtension(filePath: string) {
  const match = /\.([a-z0-9]+)$/i.exec(filePath)
  return match?.[1]?.toLowerCase() ?? null
}

function getFileName(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/")
  const segments = normalized.split("/").filter(Boolean)
  return segments.at(-1) ?? filePath
}

function inferArtifactType(filePath: string): ArtifactType {
  const extension = getFileExtension(filePath)

  if (!extension) {
    return "text"
  }

  if (
    ["ts", "tsx", "js", "jsx", "json", "py", "sql", "css", "html"].includes(
      extension
    )
  ) {
    return "code"
  }

  if (["csv"].includes(extension)) {
    return "sheet"
  }

  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "image"
  }

  return "text"
}

function inferLanguage(filePath: string) {
  const extension = getFileExtension(filePath)

  if (!extension) {
    return undefined
  }

  const languageMap: Record<string, string> = {
    css: "css",
    html: "html",
    js: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    jsx: "jsx",
  }

  return languageMap[extension]
}

function isToolOutputPart(part: UIMessage["parts"][number]): part is ToolPart {
  return (
    part.type.startsWith("tool-") &&
    "state" in part &&
    part.state === "output-available"
  )
}

function getToolOutput(part: ToolPart): ToolOutputPayload | null {
  if (!("output" in part) || !part.output || typeof part.output !== "object") {
    return null
  }

  return part.output as ToolOutputPayload
}

function buildArtifactFromToolPart(part: ToolPart): Artifact | null {
  const output = getToolOutput(part)

  if (!output?.input || typeof output.input !== "object") {
    return null
  }

  const filePath =
    typeof output.input.file_path === "string" ? output.input.file_path : null
  const content =
    typeof output.input.content === "string"
      ? output.input.content
      : typeof output.input.new_string === "string"
        ? output.input.new_string
        : null

  if (!filePath || content === null) {
    return null
  }

  const type = inferArtifactType(filePath)

  return {
    id: `artifact:${part.toolCallId}`,
    type,
    title: getFileName(filePath),
    content,
    language: type === "code" ? inferLanguage(filePath) : undefined,
    metadata: {
      filePath,
      sourceToolCallId: part.toolCallId,
      sourceToolName: output.toolName ?? part.type.replace(/^tool-/, ""),
      status: output.status ?? null,
      outputText: output.text ?? "",
    },
  }
}

export function getArtifactFromToolPart(part: UIMessage["parts"][number]) {
  if (!isToolOutputPart(part)) {
    return null
  }

  return buildArtifactFromToolPart(part)
}

export function getArtifactsFromUIMessage(message: UIMessage): Artifact[] {
  return message.parts
    .filter(isToolOutputPart)
    .map(buildArtifactFromToolPart)
    .filter((artifact): artifact is Artifact => artifact !== null)
}

export function getLatestArtifactFromUIMessage(message: UIMessage) {
  return getArtifactsFromUIMessage(message).at(-1) ?? null
}
