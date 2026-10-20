import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api/notebooks": {
        target:
          loadEnv(mode, ".", "NOTEBOOK_").NOTEBOOK_TARGET ??
          "http://127.0.0.1:5190",
        ws: true,
      },
    },
  },
  worker: {
    format: "es",
  },
}));
