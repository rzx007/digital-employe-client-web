import type { RPCSchema } from "electrobun"

type BunRequests = {
  getSystemInfo: {
    params: {}
    response: {
      platform: string
      arch: string
      bunVersion: string
    }
  }
  readFile: {
    params: { filePath: string }
    response: { content: string; error?: string }
  }
  writeFile: {
    params: { filePath: string; content: string }
    response: { success: boolean; error?: string }
  }
  showOpenDialog: {
    params: { allowedFileTypes?: string }
    response: { filePath: string | null }
  }
  showMessageBox: {
    params: {
      title: string
      message: string
      type?: "info" | "warning" | "error"
    }
    response: { response: number }
  }
  startPythonServer: {
    params: {}
    response: { success: boolean; error?: string }
  }
  stopPythonServer: {
    params: {}
    response: { success: boolean }
  }
}

type BunMessages = {}

type WebviewRequests = {}

type WebviewMessages = {
  logFromRenderer: { level: "info" | "warn" | "error"; message: string }
  openExternal: { url: string }
}

export type AppElectrobunRPCSchema = {
  bun: RPCSchema<{ requests: BunRequests; messages: BunMessages }>
  webview: RPCSchema<{ requests: WebviewRequests; messages: WebviewMessages }>
}
