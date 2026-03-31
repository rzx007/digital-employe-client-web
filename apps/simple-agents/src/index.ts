import "dotenv/config"
import { serve } from "@hono/node-server"
import { app, DATA_DIR } from "./app"

const port = Number(process.env.PORT) || 3001
console.log(`Agent server running on http://localhost:${port}`)
console.log(`Data directory: ${DATA_DIR}`)

const server = serve({ fetch: app.fetch, port })

process.on("SIGINT", () => {
  server.close()
  process.exit(0)
})
process.on("SIGTERM", () => {
  server.close((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
    process.exit(0)
  })
})
