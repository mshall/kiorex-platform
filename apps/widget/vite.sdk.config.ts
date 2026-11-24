import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

/** SDK: one IIFE, no dependencies; scripts/finalize-sdk.mjs hashes it into dist/sdk/sdk.<hash>.js + manifest.json (SRI value). */
export default defineConfig({
  define: { __KX_VERSION__: JSON.stringify(version) },
  build: {
    outDir: 'dist/sdk-raw', emptyOutDir: true, target: 'es2018', minify: true, sourcemap: false, cssCodeSplit: false,
    lib: { entry: 'src/sdk/loader.ts', name: 'KiorexWidgetSdk', formats: ['iife'], fileName: () => 'sdk.js' },
  },
});
