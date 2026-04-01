import "dotenv/config"
import { serve } from "@hono/node-server"
import { setup, DATA_DIR, cronScheduler } from "./app"

export const DEFAULT_PORT = 3005

const port = Number(process.env.PORT) || DEFAULT_PORT
console.log(`Agent server running on http://localhost:${port}`)
console.log(`Data directory: ${DATA_DIR}`)

const server = serve({ fetch: setup().fetch, port })

cronScheduler.start().catch((err) => {
  console.error("[CronScheduler] Failed to start:", err)
})

process.on("SIGINT", () => {
  cronScheduler.stop()
  server.close()
  process.exit(0)
})
process.on("SIGTERM", () => {
  cronScheduler.stop()
  server.close((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
    process.exit(0)
  })
})
