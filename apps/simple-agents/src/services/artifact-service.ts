import type { Artifact } from "../types"
import { db, DATA_DIR } from "../db"
import { artifacts } from "../db/schema"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import path from "node:path"
import fs from "node:fs"

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".py": "text/x-python",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
}

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  return MIME_TYPES[ext] || "application/octet-stream"
}

export async function syncArtifacts(
  sessionId: string,
  existingFiles: Set<string>
): Promise<{ added: Artifact[]; removed: Artifact[] }> {
  const sessionDir = path.join(DATA_DIR, "workspace", sessionId)

  const existing = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.sessionId, sessionId))

  const existingMap = new Map<string, Artifact>()
  for (const row of existing) {
    existingMap.set(row.filePath, row)
  }

  const added: Artifact[] = []
  const removed: Artifact[] = []

  for (const filePath of existingFiles) {
    if (!existingMap.has(filePath)) {
      const fullPath = path.join(sessionDir, filePath)
      const stat = fs.statSync(fullPath)
      const fileName = path.basename(filePath)

      const [artifact] = await db
        .insert(artifacts)
        .values({
          id: nanoid(),
          sessionId,
          filePath,
          fileName,
          fileSize: stat.size,
          mimeType: getMimeType(fileName),
        })
        .returning()

      added.push(artifact)
    }
  }

  for (const [filePath, artifact] of existingMap) {
    if (!existingFiles.has(filePath)) {
      await db.delete(artifacts).where(eq(artifacts.id, artifact.id))
      removed.push(artifact)
    }
  }

  return { added, removed }
}

export function getSessionFiles(sessionId: string): Set<string> {
  const sessionDir = path.join(DATA_DIR, "workspace", sessionId)
  const files = new Set<string>()

  if (!fs.existsSync(sessionDir)) return files

  function walk(dir: string, base: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relativePath)
      } else {
        files.add(relativePath)
      }
    }
  }

  walk(sessionDir, "")
  return files
}

export async function listArtifacts(sessionId: string): Promise<Artifact[]> {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.sessionId, sessionId))
    .orderBy(artifacts.createdAt)
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, id))
    .limit(1)

  return artifact || null
}

export async function deleteArtifact(id: string): Promise<boolean> {
  const artifact = await getArtifact(id)
  if (!artifact) return false

  const filePath = path.join(
    DATA_DIR,
    "workspace",
    artifact.sessionId,
    artifact.filePath
  )
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }

  const result = await db
    .delete(artifacts)
    .where(eq(artifacts.id, id))
    .returning()
  return result.length > 0
}

export async function deleteSessionArtifacts(sessionId: string): Promise<void> {
  await db.delete(artifacts).where(eq(artifacts.sessionId, sessionId))
}
