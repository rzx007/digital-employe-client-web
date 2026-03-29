import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
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
    },
  },
})
