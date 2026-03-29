import { join } from "node:path"

const ROOT = import.meta.dir
console.log("[pre-build] ROOT:", process.env.ELECTROBUN_DEV)

if (process.env.ELECTROBUN_DEV) {
  console.log("[pre-build] Dev mode, skipping Vite build")
  process.exit(0)
}

console.log("[pre-build] Running Vite build...")

const viteBuild = Bun.spawn(["bun", "run", "build"], {
  cwd: join(ROOT, ".."),
  stdout: "inherit",
  stderr: "inherit",
})

const exitCode = await viteBuild.exited
if (exitCode !== 0) {
  console.error(`[pre-build] Vite build failed with exit code ${exitCode}`)
  process.exit(1)
}

console.log("[pre-build] Vite build completed successfully")
