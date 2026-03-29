import { BrowserWindow, BrowserView, Utils } from "electrobun/bun"
import Electrobun from "electrobun/bun"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type AppElectrobunRPCSchema } from "./rpc-schema"
import { setupMenu } from "./menu"
import { startPythonServer, stopPythonServer } from "./setup-py"

function setupRPC() {
  return BrowserView.defineRPC<AppElectrobunRPCSchema>({
    maxRequestTime: 10000,
    handlers: {
      requests: {
        getSystemInfo: () => ({
          platform: process.platform,
          arch: process.arch,
          bunVersion: Bun.version,
        }),
        readFile: ({ filePath }: { filePath: string }) => {
          try {
            const content = readFileSync(filePath, "utf-8")
            return { content }
          } catch (err: any) {
            return { content: "", error: err.message }
          }
        },
        writeFile: ({
          filePath,
          content,
        }: {
          filePath: string
          content: string
        }) => {
          try {
            mkdirSync(join(filePath, ".."), { recursive: true })
            writeFileSync(filePath, content, "utf-8")
            return { success: true }
          } catch (err: any) {
            return { success: false, error: err.message }
          }
        },
        showOpenDialog: async ({
          allowedFileTypes,
        }: {
          allowedFileTypes?: string
        }) => {
          try {
            const result = await Utils.openFileDialog({
              allowedFileTypes: allowedFileTypes || "*",
              canChooseFiles: true,
              canChooseDirectory: false,
              allowsMultipleSelection: false,
            })
            return { filePath: result[0] || null }
          } catch {
            return { filePath: null }
          }
        },
        showMessageBox: async ({
          title,
          message,
          type,
        }: {
          title: string
          message: string
          type?: "info" | "warning" | "error"
        }) => {
          const result = await Utils.showMessageBox({
            title,
            message,
            type: type || "info",
          })
          return { response: result.response }
        },
        startPythonServer: () => startPythonServer(),
        stopPythonServer: () => stopPythonServer(),
      },
      messages: {
        "*": (name: string, payload: any) =>
          console.log("[RPC MSG]", name, payload),
      },
    },
  })
}

function setupEvents() {
  Electrobun.events.on("before-quit", () => {
    console.log("App quitting...")
    stopPythonServer()
  })
}

function createMainWindow(rpc: ReturnType<typeof setupRPC>) {
  const isDev = !!process.env.DEV_SERVER_URL
  const url = isDev ? process.env.DEV_SERVER_URL : "views://main/index.html"

  console.log(`Loading URL: ${url}`)

  const win = new BrowserWindow({
    title: "Digital Employee",
    url,
    frame: { x: 0, y: 0, width: 1200, height: 800 },
    rpc,
  })

  win.on("close", () => console.log("Main window closed"))

  return win
}

function main() {
  const rpc = setupRPC()
  setupMenu()
  setupEvents()
  createMainWindow(rpc)
  console.log("Digital Employee desktop app started")
}

main()
