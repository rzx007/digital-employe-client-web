import { Hono } from "hono"
import {
  createGroup,
  getGroup,
  listGroups,
  updateGroup,
  deleteGroup,
} from "../services/group-service"
import type { CreateGroupInput, UpdateGroupInput } from "../types"

const app = new Hono()

app.post("/", async (c) => {
  const body = await c.req.json<CreateGroupInput>()

  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required (string)" }, 400)
  }

  if (!Array.isArray(body.employeeIds)) {
    return c.json({ error: "employeeIds is required (string[])" }, 400)
  }

  try {
    const group = await createGroup(body)
    return c.json(group, 201)
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to create group" }, 500)
  }
})

app.get("/", async (c) => {
  const groups = await listGroups()
  return c.json(groups)
})

app.get("/:id", async (c) => {
  const id = c.req.param("id")
  const group = await getGroup(id)
  if (!group) return c.json({ error: "Group not found" }, 404)
  return c.json(group)
})

app.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<UpdateGroupInput>()

  const group = await updateGroup(id, body)
  if (!group) return c.json({ error: "Group not found" }, 404)
  return c.json(group)
})

app.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const deleted = await deleteGroup(id)
  if (!deleted) return c.json({ error: "Group not found" }, 404)
  return c.json({ success: true })
})

export default app
