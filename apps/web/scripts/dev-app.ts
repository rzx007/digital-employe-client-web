import { spawn } from "node:child_process"

const vite = spawn("bun", ["run", "dev"], {
  cwd: import.meta.dir.replace(/scripts$/, ""),
  stdio: "inherit",
  shell: true,
})

const electrobun = spawn("bunx", ["electrobun", "dev"], {
  cwd: import.meta.dir.replace(/scripts$/, ""),
  env: {
    ...process.env,
    ELECTROBUN_DEV: "true",
    DEV_SERVER_URL: "http://localhost:3399",
  },
  stdio: "inherit",
  shell: true,
})

process.on("SIGINT", () => {
  vite.kill()
  electrobun.kill()
  process.exit(0)
})

process.on("SIGTERM", () => {
  vite.kill()
  electrobun.kill()
  process.exit(0)
})
