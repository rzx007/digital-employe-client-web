import { join } from "node:path"

let pythonProcess: ReturnType<typeof Bun.spawn> | null = null

export function startPythonServer(): { success: boolean; error?: string } {
  if (pythonProcess) {
    return { success: true }
  }

  try {
    const pythonPath = join(import.meta.dir, "..", "python", "server.exe")
    console.log("Starting Python server:", pythonPath)

    pythonProcess = Bun.spawn([pythonPath], {
      cwd: join(pythonPath, ".."),
      stderr: "ignore",
      stdout: "ignore",
      stdin: "ignore",
    })

    pythonProcess.unref()

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export function stopPythonServer(): { success: boolean } {
  if (!pythonProcess) {
    return { success: true }
  }

  try {
    pythonProcess.kill()
    pythonProcess = null
    return { success: true }
  } catch {
    pythonProcess = null
    return { success: true }
  }
}
