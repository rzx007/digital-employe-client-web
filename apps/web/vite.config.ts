import path from "path"
import pkg from "./package.json"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import electron from "vite-plugin-electron/simple"
import { defineConfig, type ConfigEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ command, mode }: ConfigEnv) => {
  const isServe = command === "serve"
  const isBuild = command === "build"
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  const externalDeps = [
    ...Object.keys("dependencies" in pkg ? pkg.dependencies : {}),
  ].filter((d) => d !== "simple-agents")

  const nativeAddons = ["better-sqlite3", "bindings", "file-uri-to-path"]

  return {
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
      ...(mode === "electron"
        ? [
            electron({
              main: {
                // Shortcut of `build.lib.entry`
                entry: "electron/main/index.ts",
                onstart({ startup }) {
                  if (process.env.VSCODE_DEBUG) {
                    console.log(
                      /* For `.vscode/.debug.script.mjs` */ "[startup] Electron App"
                    )
                  } else {
                    startup()
                  }
                },
                vite: {
                  build: {
                    sourcemap,
                    minify: isBuild,
                    outDir: "dist-electron/main",
                    rollupOptions: {
                      external: [...externalDeps, ...nativeAddons],
                    },
                  },
                },
              },
              preload: {
                // Shortcut of `build.rollupOptions.input`.
                // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
                input: "electron/preload/index.ts",
                vite: {
                  build: {
                    sourcemap: sourcemap ? "inline" : undefined, // #332
                    minify: isBuild,
                    outDir: "dist-electron/preload",
                    rollupOptions: {
                      external: Object.keys(
                        "dependencies" in pkg ? pkg.dependencies : {}
                      ),
                    },
                  },
                },
              },
              // Ployfill the Electron and Node.js API for Renderer process.
              // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
              // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
              renderer: {},
            }),
          ]
        : []),
    ],
    base: "./",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 3399,
      host: "0.0.0.0",
      open: true,
      proxy: {
        "/actus": {
          target: "http://10.172.246.122:8000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/actus/, ""),
        },
        "/simple-agents": {
          target: "http://localhost:3005",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/simple-agents/, ""),
        },
      },
    },
  }
})
