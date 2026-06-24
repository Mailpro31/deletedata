import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev : `npm run dev` (Vite sur :5173) proxy /api -> l'API locale (:4317).
// En prod : `npm run build` -> web/dist, servi par l'API Express (cli serve).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4317" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
