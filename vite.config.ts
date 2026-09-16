import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    // Cargo rewrites .exe/.dll files in src-tauri/target during `tauri dev`, which
    // crashes Vite's Windows file watcher with EBUSY (errno -4082).
    // A function is used instead of a glob because picomatch `**` does not match
    // dot-directories (e.g. .freebuff/worktrees/...), silently breaking globs here.
    watch: {
      ignored: (watchedPath: string) => watchedPath.includes("src-tauri/target"),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
