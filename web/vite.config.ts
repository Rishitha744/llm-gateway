import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// In dev, API calls are proxied to the gateway (via nginx on :8080 by default).
const target = process.env.GATEWAY_URL ?? "http://localhost:8080";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "demo" ? "./" : "/",
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
          charts: ["recharts"],
        },
      },
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/v1", "/admin", "/health", "/docs", "/openapi.json"].map((p) => [p, { target, changeOrigin: true }]),
    ),
  },
}));
