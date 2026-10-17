import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath, URL } from "node:url"

// The hub serves the built theme from its themes directory and proxies /api
// itself. In development there is no hub, so both /api and the WebSocket it
// carries are proxied to one: MONITOR_HUB when set, else the bundled mock.
const HUB = process.env.MONITOR_HUB || "http://127.0.0.1:9911"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // Straight into the theme directory that `build-theme.mjs` assembles, so
    // `vite build` alone leaves something the hub could be pointed at.
    outDir: "cardgridnd/dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": { target: HUB, changeOrigin: true, ws: true },
    },
  },
})
