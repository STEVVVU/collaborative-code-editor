import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", "apps/notebook-server/**"],
    setupFiles: "./apps/playground/src/test/setup.ts",
  },
});
