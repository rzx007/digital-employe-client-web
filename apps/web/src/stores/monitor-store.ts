import { create } from "zustand"

interface MonitorStore {
    isOpen: boolean
    isFullscreen: boolean
    targetEmployeeId: string | null

    openMonitor: (employeeId: string) => void
    closeMonitor: () => void
    toggleFullscreen: () => void
    setFullscreen: (fullscreen: boolean) => void
}

export const useMonitorStore = create<MonitorStore>((set) => ({
    isOpen: false,
    isFullscreen: false,
    targetEmployeeId: null,

    openMonitor: (employeeId) =>
        set({ isOpen: true, isFullscreen: false, targetEmployeeId: employeeId }),

    closeMonitor: () =>
        set({ isOpen: false, isFullscreen: false, targetEmployeeId: null }),

    toggleFullscreen: () =>
        set((state) => ({ isFullscreen: !state.isFullscreen })),

    setFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
}))