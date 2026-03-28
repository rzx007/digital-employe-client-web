import { Hono } from "hono"
import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
} from "../services/session-service"
import type { CreateSessionInput, UpdateSessionInput } from "../types"

const app = new Hono()

app.post("/", async (c) => {
  const body = await c.req.json<CreateSessionInput>()
  const session = await createSession(body)
  return c.json(session, 201)
})

app.get("/", async (c) => {
  const page = Number(c.req.query("page")) || 1
  const pageSize = Number(c.req.query("pageSize")) || 20
  const includeArchived = c.req.query("includeArchived") === "true"

  const result = await listSessions(page, pageSize, includeArchived)
  return c.json(result)
})

app.get("/:id", async (c) => {
  const id = c.req.param("id")
  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)
  return c.json(session)
})

app.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<UpdateSessionInput>()
  const session = await updateSession(id, body)
  if (!session) return c.json({ error: "Session not found" }, 404)
  return c.json(session)
})

app.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const deleted = await deleteSession(id)
  if (!deleted) return c.json({ error: "Session not found" }, 404)
  return c.json({ success: true })
})

export default app
