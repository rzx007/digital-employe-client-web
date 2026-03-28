interface IpcRendererAPI {
  on: (channel: string, listener: (...args: any[]) => void) => Electron.IpcRenderer
  off: (channel: string, ...args: any[]) => Electron.IpcRenderer
  send: (channel: string, ...args: any[]) => any
  invoke: (channel: string, ...args: any[]) => Promise<any>
  removeListener: (channel: string, listener: (...args: any[]) => void) => Electron.IpcRenderer
  resizeWindow: (size: { height: number; width: number }) => void
  getPlatform: () => {
    isLinux: boolean
    isWin: boolean
    isMac: boolean
  }
  // Store API
  getStoreValue: (key: string) => Promise<any>
  setStoreValue: (key: string, value: any) => Promise<void>
  getAllStore: () => Promise<any>
  clearStore: () => Promise<void>
}

declare global {
  interface Window {
    ipcRenderer?: IpcRendererAPI
    electronApi?: {
      startServerForSpawn: () => void
      quitApp: () => void
      setBaseURL: (baseUrl: string) => void
      registerAppMenu: (data: any) => void
      setForceQuitCode: (code: boolean) => void
      setMaximize: () => void
      getPlatform: () => {
        isLinux: boolean
        isWin: boolean
        isMac: boolean
      }
      minimizeWindow: () => void
      closeWindow: () => void
      isMaximized: () => boolean
    }
  }
  const __APP_VERSION__: string
  const __BUILD_TIME__: string
  const __ENV__: string
  const __APP_PORT__: string
}
export {}
