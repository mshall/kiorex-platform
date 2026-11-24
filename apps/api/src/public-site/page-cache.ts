/**
 * In-process page cache of the public site (one tier below CloudFront). Keyed by path plus whitelisted query, never by cookies or headers, so one
 * response is shared by every visitor (no private data can ever enter it: the render path does not read the session). Entries carry tags so the
 * LISTING_STATUS_CHANGED / PROVIDER_PROFILE_UPDATED consumer can purge precisely. Small LRU with a TTL; stale entries are dropped, not served.
 */
export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  etag: string;
  tags: string[];
  lastModified?: string;
}

export class PageCache {
  private map = new Map<string, { at: number; value: CachedResponse }>();
  hits = 0;
  misses = 0;
  constructor(private readonly maxEntries: number, private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get(key: string): CachedResponse | undefined {
    const e = this.map.get(key);
    if (!e) { this.misses++; return undefined; }
    if (this.now() - e.at > this.ttlMs) { this.map.delete(key); this.misses++; return undefined; }
    this.map.delete(key); this.map.set(key, e); // LRU touch
    this.hits++;
    return e.value;
  }
  set(key: string, value: CachedResponse): void {
    this.map.delete(key);
    this.map.set(key, { at: this.now(), value });
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value as string);
  }
  /** Drop every entry carrying one of the tags; returns the cache keys removed (the CDN purge paths). */
  purgeTags(tags: readonly string[]): string[] {
    const want = new Set(tags);
    const gone: string[] = [];
    for (const [k, e] of this.map) if (e.value.tags.some((t) => want.has(t))) { this.map.delete(k); gone.push(k); }
    return gone;
  }
  clear(): number { const n = this.map.size; this.map.clear(); return n; }
  get size(): number { return this.map.size; }
}
