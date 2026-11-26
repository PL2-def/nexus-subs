import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_TARGET || "http://localhost:3001";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    target: "esnext"
  },
  server: {
    port: 3000,
    open: false,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0
      }
    }
  }
});
