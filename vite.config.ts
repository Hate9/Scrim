import { defineConfig } from "vite";

// Tauri expects a fixed dev port and no screen clearing.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: {
    target: "es2022",
    // Everything ships in the app; no CDN (spec 19).
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  test: { include: ["src/**/*.test.ts"] },
});
