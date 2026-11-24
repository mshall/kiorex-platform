/** Tiny in-process metrics for the public site (render time, cache hit ratio, outcome counts). Exposed on /_site/health and /_site/metrics. */
export class SiteMetrics {
  private renderMs: number[] = [];
  readonly counts: Record<string, number> = {};
  inc(name: string, by = 1): void { this.counts[name] = (this.counts[name] ?? 0) + by; }
  observeRender(ms: number): void { this.renderMs.push(ms); if (this.renderMs.length > 500) this.renderMs.shift(); }
  percentile(p: number): number | null {
    if (!this.renderMs.length) return null;
    const s = [...this.renderMs].sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! * 100) / 100;
  }
  snapshot(cache: { hits: number; misses: number; size: number }) {
    const total = cache.hits + cache.misses;
    return {
      render: { count: this.renderMs.length, p50Ms: this.percentile(50), p95Ms: this.percentile(95), maxMs: this.renderMs.length ? Math.max(...this.renderMs) : null },
      cache: { hits: cache.hits, misses: cache.misses, entries: cache.size, hitRatio: total ? Math.round((cache.hits / total) * 1000) / 1000 : null },
      counts: { ...this.counts },
    };
  }
  /** Prometheus text exposition (no labels with user data). */
  prometheus(cache: { hits: number; misses: number; size: number }): string {
    const s = this.snapshot(cache);
    const lines = [
      '# TYPE kx_site_cache_hits_total counter', `kx_site_cache_hits_total ${s.cache.hits}`,
      '# TYPE kx_site_cache_misses_total counter', `kx_site_cache_misses_total ${s.cache.misses}`,
      '# TYPE kx_site_cache_entries gauge', `kx_site_cache_entries ${s.cache.entries}`,
      '# TYPE kx_site_render_ms summary',
      `kx_site_render_ms{quantile="0.5"} ${s.render.p50Ms ?? 'NaN'}`, `kx_site_render_ms{quantile="0.95"} ${s.render.p95Ms ?? 'NaN'}`, `kx_site_render_ms_count ${s.render.count}`,
    ];
    for (const [k, v] of Object.entries(s.counts)) lines.push(`kx_site_${k.replace(/[^a-z0-9_]/gi, '_')}_total ${v}`);
    return `${lines.join('\n')}\n`;
  }
}
