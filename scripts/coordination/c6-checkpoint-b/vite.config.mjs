import { defineConfig } from "E:/AI/BERT_Project/codepython/KLTN/frontend/node_modules/vite/dist/node/index.js";
import tailwindcss from "E:/AI/BERT_Project/codepython/KLTN/frontend/node_modules/@tailwindcss/vite/dist/index.mjs";

const frontendPort = parseInt(process.env.VITE_PORT || "5225", 10);
const backendPort = parseInt(process.env.BACKEND_PORT || "8125", 10);

export default defineConfig({
  root: "E:/AI/BERT_Project/codepython/KLTN/frontend",
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  define: {
    "import.meta.env.VITE_DATA_MODE": JSON.stringify("api"),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api/v1"),
  },
  server: {
    host: "127.0.0.1",
    port: frontendPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});

