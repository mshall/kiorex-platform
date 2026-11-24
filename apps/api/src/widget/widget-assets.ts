import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { widgetCfg } from './widget.config';

export interface SdkManifest { name: string; version: string; hash: string; file: string; path: string; integrity: string; bytes: number; gzipBytes: number }
export interface AppFiles { main: string; callback: string; css: string | null }

/** The built widget (apps/widget/dist): hashed app files, the callback script and the versioned SDK. Read lazily and cached; 503 `WIDGET_NOT_BUILT` when missing. */
@Injectable()
export class WidgetAssets {
  private app?: AppFiles; private appDir = ''; private sdk?: { manifest: SdkManifest; body: Buffer; etag: string }; private files?: Set<string>;

  private load() {
    const dir = widgetCfg().dist;
    if (this.app && this.appDir === dir) return;
    const manifestPath = join(dir, 'app/.vite/manifest.json');
    if (!existsSync(manifestPath)) throw new Error('WIDGET_NOT_BUILT');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, { file: string }>;
    const main = m['src/app/main.tsx']?.file; const callback = m['src/app/callback.ts']?.file; const css = m['style.css']?.file ?? null;
    if (!main || !callback) throw new Error('WIDGET_NOT_BUILT');
    this.app = { main, callback, css }; this.appDir = dir;
    this.files = new Set(readdirSync(join(dir, 'app')).filter((f) => /^[A-Za-z0-9._-]+\.(js|css)$/.test(f)));
    const sm = JSON.parse(readFileSync(join(dir, 'sdk/manifest.json'), 'utf8')) as SdkManifest;
    const body = readFileSync(join(dir, 'sdk', sm.file));
    this.sdk = { manifest: sm, body, etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 27)}"` };
  }
  ready(): boolean { try { this.load(); return true; } catch { return false; } }
  appFiles(): AppFiles { this.load(); return this.app!; }
  sdkFile() { this.load(); return this.sdk!; }
  /** A file of the app build by name (only names that exist in the build directory: no path is ever built from the request). */
  appAsset(name: string): { body: Buffer; type: string } | null {
    this.load();
    if (!this.files!.has(name)) return null;
    return { body: readFileSync(join(this.appDir, 'app', name)), type: name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' };
  }
}
