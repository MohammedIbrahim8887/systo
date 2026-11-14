import { defineConfig } from "@farm.js/core";

export default defineConfig({
  theme: {
    default: "dark",
    storageKey: "systo-theme",
  },
  desktop: {
    name: "Systo",
    id: "dev.systo.monitor",
    icon: "assets/icon.png",
    window: { width: 1180, height: 760, title: "Systo" },
  },
});
