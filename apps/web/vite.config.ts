import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

/** Link previews (WhatsApp, Telegram, X) need ABSOLUTE og:image and og:url: __KX_SITE_URL__ in index.html becomes VITE_SITE_URL (generated from the URL registry per environment), else the production host. */
const shareOrigin = (): string => (process.env.VITE_SITE_URL?.trim() || "https://kiorex.com").replace(/\/+$/, "");
const shareTags = { name: "kx-share-origin", transformIndexHtml: (html: string) => html.replaceAll("__KX_SITE_URL__", shareOrigin()) };

export default defineConfig({
  plugins: [react(), shareTags],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // maplibre-gl 6 spawns its ESM worker via import.meta.url: pre-bundling moves the module and breaks that URL ("Worker failed to load", blank map in dev)
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.KIOREX_API_URL ?? "http://localhost:4000", changeOrigin: true },
      // GRW-P1-E: public SSR pages, robots, sitemaps and their hashed assets are served by the Kiorex API (role `all`); the SPA owns everything else
      "^/(ar|en)/[a-z]{2}(/|$)": { target: process.env.KIOREX_API_URL ?? "http://localhost:4000", changeOrigin: true },
      "^/(robots\\.txt|sitemap\\.xml|sitemaps/|_p/|_site/)": { target: process.env.KIOREX_API_URL ?? "http://localhost:4000", changeOrigin: true },
    },
  },
  preview: { port: 5180, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
