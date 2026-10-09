import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Files from ui/public the app shell needs offline; the hashed build output is added per build.
const PUBLIC_SHELL = [
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Writes dist/ui/sw.js from ui/sw.js with this build's file list. The cache name changes with
// the list, so a new build replaces the old cache instead of serving a stale bundle.
function serviceWorker(): Plugin {
  return {
    name: "plania-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      // Fonts come in many subsets; they are cached the first time a page uses them instead.
      const built = Object.keys(bundle)
        .filter((f) => f.startsWith("assets/") && !/\.(map|woff2?)$/.test(f))
        .map((f) => `/${f}`);
      const precache = [...PUBLIC_SHELL, ...built.sort()];
      const version = createHash("sha256").update(precache.join("\n")).digest("hex").slice(0, 12);
      const source = readFileSync(path.resolve(import.meta.dirname, "ui/sw.js"), "utf8")
        .replace('"__VERSION__"', JSON.stringify(version))
        .replace("__PRECACHE__", JSON.stringify(precache));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// The SPA lives in ui/ and builds to dist/ui, which the local server serves on 3737.
// In dev, Vite runs on 5173 and proxies the API and MCP to the dev API server on 3738.
export default defineConfig({
  root: path.resolve(import.meta.dirname, "ui"),
  plugins: [react(), tailwindcss(), serviceWorker()],
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
