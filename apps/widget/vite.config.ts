import { defineConfig } from 'vite';

/** The widget app (served by the Kiorex API image under /v1/embed/assets/). `main` is the iframe app, `callback` the popup return page script. */
export default defineConfig({
  base: '/v1/embed/assets/',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: 'dist/app', emptyOutDir: true, manifest: true, target: 'es2020', sourcemap: false, cssCodeSplit: false, assetsInlineLimit: 0, assetsDir: '.',
    rollupOptions: { input: { main: 'src/app/main.tsx', callback: 'src/app/callback.ts' } },
  },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] },
} as never);
