import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientAssets } from './head';
import type { PageData } from './site-data.types';
import type { Locale, PageQuery } from './url-policy';
import { siteCfg } from './site.config';

/** Contract with the Vite SSR bundle (apps/web/src/entry-server.tsx exports `render`). Plain JSON in, plain JSON and an HTML string out. */
export interface SsrInput {
  locale: Locale; cc: string; type: string; path: string; query: PageQuery; data: PageData;
  site: { canonicalHost: string; reviewMarkup: boolean; /** versioned SEO config: title and description templates per locale and page type (validated, may be empty) */ templates?: Record<string, Record<string, { title?: string; description?: string }>>; /** optional image resizing CDN base (SITE_IMAGE_CDN), null = originals */ imageCdn?: string | null };
}
export interface SsrOutput {
  html: string;
  meta: { title: string; description: string; ogImage?: string | null };
  jsonLd: unknown[];
}
export interface SsrModule { render(input: SsrInput): Promise<SsrOutput> | SsrOutput }

/** Port so tests can inject a renderer and the role can be split later without touching the controller. */
export abstract class SiteRenderer {
  abstract available(): boolean;
  abstract render(input: SsrInput): Promise<SsrOutput>;
  abstract assets(): ClientAssets;
  /** Assets the SPA shell fallback needs are the patient web's own; nothing to resolve here. */
  abstract spaShell(): string | null;
}

interface ManifestEntry { file: string; css?: string[]; imports?: string[]; isEntry?: boolean; src?: string; assets?: string[] }

@Injectable()
export class BundleRenderer extends SiteRenderer {
  private readonly log = new Logger('SiteRenderer');
  private mod: SsrModule | null = null;
  private mtime = 0;
  private assetsCache: { key: string; value: ClientAssets } | null = null;

  available(): boolean { return existsSync(siteCfg().ssrBundle); }

  private load(): SsrModule {
    const file = siteCfg().ssrBundle;
    const m = statSync(file).mtimeMs;
    if (!this.mod || m !== this.mtime) {
      delete require.cache[require.resolve(file)];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require(file) as SsrModule;
      if (typeof loaded.render !== 'function') throw new Error('SSR bundle does not export render()');
      this.mod = loaded; this.mtime = m;
      this.log.log(`SSR bundle loaded (${file})`);
    }
    return this.mod;
  }

  async render(input: SsrInput): Promise<SsrOutput> {
    const timeout = siteCfg().renderTimeoutMs;
    return await Promise.race([
      Promise.resolve(this.load().render(input)),
      new Promise<never>((_, rej) => { const t = setTimeout(() => rej(new Error(`SSR render timed out after ${timeout} ms`)), timeout); t.unref(); }),
    ]);
  }

  /** Client assets from the Vite manifest of the public build: entry script, modulepreloads, inline CSS, font preloads. */
  assets(): ClientAssets {
    const dir = siteCfg().publicClientDir;
    const manifestFile = join(dir, '.vite', 'manifest.json');
    if (!existsSync(manifestFile)) return { css: '', script: null, modulePreloads: [], fontPreloads: [] };
    const key = `${manifestFile}:${statSync(manifestFile).mtimeMs}`;
    if (this.assetsCache?.key === key) return this.assetsCache.value;
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, ManifestEntry>;
    const prefix = siteCfg().assetPrefix;
    const url = (f: string) => `${prefix}/${f}`;
    const entry = Object.values(manifest).find((e) => e.isEntry);
    // with cssCodeSplit=false Vite emits one stylesheet as its own manifest entry (key style.css), not under the JS entry
    const css = [...new Set([...(entry?.css ?? []), ...(entry?.imports ?? []).flatMap((i) => manifest[i]?.css ?? []), ...Object.values(manifest).filter((e) => e.file.endsWith('.css')).map((e) => e.file)])]
      .map((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '')).join('');
    const fonts = Object.values(manifest).filter((e) => /\.woff2$/.test(e.file)).map((e) => url(e.file));
    const value: ClientAssets = {
      css, script: entry ? url(entry.file) : null,
      modulePreloads: (entry?.imports ?? []).map((i) => manifest[i]?.file).filter((f): f is string => !!f).map(url),
      // preload only the faces the first paint needs: the Arabic regular face and Latin variable face
      fontPreloads: fonts.filter((f) => /plex-arabic-400|jost-latin(?!-ext)/.test(f)),
    };
    this.assetsCache = { key, value };
    return value;
  }

  spaShell(): string | null {
    const f = siteCfg().spaShell;
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
}
