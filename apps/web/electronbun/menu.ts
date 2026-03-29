import { ApplicationMenu } from "electrobun/bun"

export function setupMenu() {
  ApplicationMenu.setApplicationMenu([
    {
      submenu: [
        { label: "About Digital Employee", action: "about" },
        { type: "separator" as const },
        { label: "Quit", role: "quit" as const },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { type: "separator" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "toggleFullScreen" as const },
        {
          label: "Toggle Developer Tools",
          action: "toggle-devtools",
        },
        { type: "separator" as const },
        { role: "reload" as const },
      ],
    },
  ])
}
