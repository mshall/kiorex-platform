import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

/**
 * Public site build (GRW-P1-E). Two outputs, both separate from the SPA build in `dist/` (which is unchanged):
 *   vite build --config ./vite.public.config.ts                              -> dist-public/client  (hydration entry + hashed assets, served under /_p/)
 *   vite build --config ./vite.public.config.ts --ssr src/entry-server.tsx   -> dist-public/server/entry-server.cjs (self-contained CommonJS, loaded by the Kiorex API)
 */
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  base: "/_p/",
  publicDir: false,
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  ssr: { noExternal: true, target: "node" },
  build: isSsrBuild
    ? {
        outDir: "dist-public/server", emptyOutDir: true, ssr: true, sourcemap: false, target: "node24", minify: false,
        rollupOptions: { input: "src/entry-server.tsx", output: { format: "cjs", entryFileNames: "entry-server.cjs", codeSplitting: false } },
      }
    : {
        outDir: "dist-public/client", emptyOutDir: true, manifest: true, sourcemap: false, cssCodeSplit: false, assetsInlineLimit: 0, target: "es2022",
        rollupOptions: { input: "src/entry-client.tsx" },
      },
}));
