import { Hono } from "hono"
import {
  listArtifacts,
  getArtifact,
  deleteArtifact,
} from "../services/artifact-service"
import { DATA_DIR } from "../db"
import path from "node:path"
import fs from "node:fs"

const app = new Hono()

app.get("/:id/artifacts", async (c) => {
  const sessionId = c.req.param("id")
  const artifacts = await listArtifacts(sessionId)
  return c.json(artifacts)
})

app.get("/:id/artifacts/:artifactId", async (c) => {
  const artifactId = c.req.param("artifactId")
  const artifact = await getArtifact(artifactId)
  if (!artifact) return c.json({ error: "Artifact not found" }, 404)

  const filePath = path.join(
    DATA_DIR,
    "workspace",
    artifact.sessionId,
    artifact.filePath
  )
  if (!fs.existsSync(filePath))
    return c.json({ error: "File not found on disk" }, 404)

  const stat = fs.statSync(filePath)
  const content = fs.readFileSync(filePath)

  return new Response(content, {
    headers: {
      "Content-Type": artifact.mimeType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${encodeURIComponent(artifact.fileName)}"`,
    },
  })
})

app.delete("/:id/artifacts/:artifactId", async (c) => {
  const artifactId = c.req.param("artifactId")
  const deleted = await deleteArtifact(artifactId)
  if (!deleted) return c.json({ error: "Artifact not found" }, 404)
  return c.json({ success: true })
})

export default app
