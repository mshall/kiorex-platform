import { SECRET_REF, UpstreamError, NeedsHumanError, type AdapterHealth, type GrowthAdapter, type GrowthIntegrationKind, type MetricRow, type PullRange } from './types';
import { outboundFetch } from '../../../common/outbound-http';

export type HttpFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number }) => Promise<{ status: number; json: unknown }>;

/** Default transport. Never exercised in CI (tests inject a recorded-fixture HttpFn). */
export const defaultHttp: HttpFn = async (url, init) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), init.timeoutMs);
  try {
    const r = await outboundFetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctl.signal });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch (e) { throw new UpstreamError((e as Error).name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_STATUS'); }
  finally { clearTimeout(t); }
};

export interface RealSpec {
  kind: GrowthIntegrationKind;
  /** Public documentation reference, version-pinned at build. VERIFY AT BUILD. */
  api: string;
  host: string;
  /** Which pull the adapter offers. */
  pulls: Array<'spend' | 'performance' | 'coreVitals'>;
  /** Pure: the request for a range. The token is passed in, never stored. */
  build(range: PullRange, secret: string, what: 'spend' | 'performance' | 'coreVitals', account: string): { url: string; method: string; headers: Record<string, string>; body?: string };
  /** Pure: documented response shape to rows. Throws UpstreamError('UPSTREAM_PARSE') on an unexpected shape. */
  parse(json: unknown, what: 'spend' | 'performance' | 'coreVitals', range: PullRange): MetricRow[];
}

export interface RealConfig { secretRef: string | null; /** account, property, site or app label (not a secret) */ account?: string; resolveSecret: (ref: string) => Promise<string | null>; http?: HttpFn; timeoutMs?: number }

/**
 * Config-only real adapter. Fails closed with NEEDS_HUMAN unless the caller says mode is real, the secretRef is well formed and the secret resolves. The secret value is held in a local
 * variable for one request and is never logged, returned or stored.
 */
export class RealAdapter implements GrowthAdapter {
  readonly mode = 'real' as const;
  readonly kind: GrowthIntegrationKind;
  constructor(private readonly spec: RealSpec, private readonly cfg: RealConfig) { this.kind = spec.kind; }

  private async secret(): Promise<string> {
    const ref = this.cfg.secretRef;
    if (!ref) throw new NeedsHumanError(this.kind, 'has no secretRef configured');
    if (!SECRET_REF.test(ref)) throw new NeedsHumanError(this.kind, 'secretRef is not a valid reference name');
    const v = await this.cfg.resolveSecret(ref);
    if (!v) throw new NeedsHumanError(this.kind, 'secret does not resolve');
    return v;
  }
  async health(): Promise<AdapterHealth> {
    try { await this.secret(); return { ok: true, mode: 'real', detail: 'secret resolves; no upstream call was made' }; }
    catch (e) { return { ok: false, mode: 'real', detail: e instanceof NeedsHumanError ? e.reason : 'unavailable' }; }
  }
  private async run(what: 'spend' | 'performance' | 'coreVitals', range: PullRange): Promise<MetricRow[]> {
    if (!this.spec.pulls.includes(what)) return [];
    const secret = await this.secret();
    const req = this.spec.build(range, secret, what, this.cfg.account ?? '');
    const res = await (this.cfg.http ?? defaultHttp)(req.url, { method: req.method, headers: req.headers, body: req.body, timeoutMs: this.cfg.timeoutMs ?? 15_000 });
    if (res.status === 429) throw new UpstreamError('RATE_LIMITED', 429);
    if (res.status < 200 || res.status >= 300) throw new UpstreamError('UPSTREAM_STATUS', res.status);
    return this.spec.parse(res.json, what, range);
  }
  pullSpend(r: PullRange) { return this.run('spend', r); }
  pullPerformance(r: PullRange) { return this.run('performance', r); }
  pullCoreVitals(r: PullRange) { return this.run('coreVitals', r); }
  /** Conversion upload is never implemented in the adapter layer in this phase (default off, counsel gate). */
}

export const num = (v: unknown): number => { const n = typeof v === 'string' ? Number(v) : (v as number); if (typeof n !== 'number' || !Number.isFinite(n)) throw new UpstreamError('UPSTREAM_PARSE'); return n; };
export const arr = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new UpstreamError('UPSTREAM_PARSE'); return v; };
export const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new UpstreamError('UPSTREAM_PARSE'); return v as Record<string, unknown>; };
export const str = (v: unknown): string => { if (typeof v !== 'string') throw new UpstreamError('UPSTREAM_PARSE'); return v; };
