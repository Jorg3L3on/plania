import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The SPA lives in ui/ and builds to dist/ui, which the local server serves on 3737.
// In dev, Vite runs on 5173 and proxies the API and MCP to the dev API server on 3738.
export default defineConfig({
  root: path.resolve(import.meta.dirname, "ui"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "ui/src") },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/ui"),
    emptyOutDir: true,
    // One local, single-user app: a ~500 kB bundle (160 kB gzipped) is fine without code splitting.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3738",
      "/mcp": "http://127.0.0.1:3738",
    },
  },
});
