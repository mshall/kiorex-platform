/**
 * G-22 CDN invalidation port. `mock` (default) records what a purge would send; `real` is the CloudFront skeleton below. The skeleton is config only: it validates its
 * settings, normalises and batches the paths exactly as the CloudFront API requires, and hands each batch to an injected sender. No AWS SDK is bundled and no sender is
 * wired in this repository: attaching the distribution (id, IAM role, region) is the go-live task NEEDS_HUMAN "CDN purge" and `tofu apply` stays human.
 */
export type CdnPurgeStatus = 'RECORDED' | 'PURGED' | 'NOT_CONFIGURED' | 'FAILED';
export interface CdnPurgeResult { status: CdnPurgeStatus; paths: number; batches: number; references: string[]; reason?: string }
export interface CdnPurgePort { readonly mode: 'mock' | 'real'; purge(paths: readonly string[]): Promise<CdnPurgeResult> }

/** CloudFront accepts at most 3,000 paths in one invalidation request. */
export const CLOUDFRONT_MAX_PATHS = 3000;

/** Pure: absolute paths only, query strings dropped (an invalidation path never carries one), de-duplicated, order kept; a path that is not a plain absolute path is refused. */
export function normalisePurgePaths(paths: readonly string[]): { paths: string[]; rejected: string[] } {
  const out: string[] = []; const rejected: string[] = []; const seen = new Set<string>();
  for (const raw of paths) {
    const p = String(raw ?? '').split('?')[0]!.split('#')[0]!.trim();
    if (!p.startsWith('/') || p.startsWith('//') || /[\s\0]/.test(p) || p.length > 1024) { rejected.push(String(raw).slice(0, 80)); continue; }
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return { paths: out, rejected };
}
export const batchPaths = (paths: readonly string[], size = CLOUDFRONT_MAX_PATHS): string[][] => { const b: string[][] = []; for (let i = 0; i < paths.length; i += size) b.push(paths.slice(i, i + size)); return b; };

export class MockCdnPurgeAdapter implements CdnPurgePort {
  readonly mode = 'mock' as const;
  readonly recent: { at: string; paths: string[] }[] = [];
  async purge(paths: readonly string[]): Promise<CdnPurgeResult> {
    const n = normalisePurgePaths(paths);
    if (!n.paths.length) return { status: 'RECORDED', paths: 0, batches: 0, references: [] };
    this.recent.push({ at: new Date().toISOString(), paths: n.paths });
    if (this.recent.length > 50) this.recent.shift();
    return { status: 'RECORDED', paths: n.paths.length, batches: batchPaths(n.paths).length, references: [] };
  }
}

export interface CloudFrontPurgeConfig { distributionId: string | null; region?: string; /** IAM role the sender assumes: a name, not a credential */ roleRef?: string | null }
/** Injected transport: one CloudFront CreateInvalidation per batch; returns the invalidation id. Absent until go-live. */
export type CloudFrontSender = (req: { distributionId: string; paths: string[]; callerReference: string }) => Promise<{ id: string }>;

export class CloudFrontPurgeAdapter implements CdnPurgePort {
  readonly mode = 'real' as const;
  constructor(private readonly cfg: CloudFrontPurgeConfig, private readonly send?: CloudFrontSender, private readonly now: () => number = Date.now) {}
  configured(): boolean { return !!this.cfg.distributionId && /^[A-Z0-9]{8,32}$/.test(this.cfg.distributionId) && !!this.send; }
  async purge(paths: readonly string[]): Promise<CdnPurgeResult> {
    const n = normalisePurgePaths(paths);
    if (!n.paths.length) return { status: 'PURGED', paths: 0, batches: 0, references: [] };
    if (!this.configured()) return { status: 'NOT_CONFIGURED', paths: n.paths.length, batches: 0, references: [], reason: 'distribution id and sender are go-live items (NEEDS_HUMAN: CDN purge); nothing was purged' };
    const refs: string[] = []; const batches = batchPaths(n.paths);
    try {
      for (const [i, b] of batches.entries()) refs.push((await this.send!({ distributionId: this.cfg.distributionId!, paths: b, callerReference: `kx-${this.now()}-${i}` })).id);
    } catch (e) { return { status: 'FAILED', paths: n.paths.length, batches: batches.length, references: refs, reason: (e as Error).name === 'Error' ? 'CDN_UPSTREAM_ERROR' : (e as Error).name }; }
    return { status: 'PURGED', paths: n.paths.length, batches: batches.length, references: refs };
  }
}

export function createCdnPurgePort(mode: 'mock' | 'real', cfg: CloudFrontPurgeConfig, send?: CloudFrontSender): CdnPurgePort {
  return mode === 'real' ? new CloudFrontPurgeAdapter(cfg, send) : new MockCdnPurgeAdapter();
}
