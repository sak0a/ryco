import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Standalone marketing app. Kept outside the monorepo workspace globs so its
// dependency tree (gsap / anime.js v4 / react-router) never disturbs the
// pinned Effect/Bun catalog used by apps/web.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5174,
    host: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
  },
});
