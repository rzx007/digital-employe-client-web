import "dotenv/config"
import { serve } from "@hono/node-server"
import { app, DATA_DIR, cronScheduler } from "./app"

const port = Number(process.env.PORT) || 3001
console.log(`Agent server running on http://localhost:${port}`)
console.log(`Data directory: ${DATA_DIR}`)

const server = serve({ fetch: app.fetch, port })

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
