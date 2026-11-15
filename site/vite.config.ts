import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const app = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The app's design system (tokens, logo, shadcn button, formatters) lives in ../src.
  resolve: { alias: { "@": resolve(import.meta.dirname, "../src") }, dedupe: ["react", "react-dom"] },
  define: { __APP_VERSION__: JSON.stringify(app.version) },
  build: {
    rollupOptions: {
      input: { home: resolve(import.meta.dirname, "index.html"), changelog: resolve(import.meta.dirname, "changelog/index.html") },
    },
  },
});
