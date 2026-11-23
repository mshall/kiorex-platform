import { createHash } from 'node:crypto';
import { cfg } from '../common/config';
import { mapsProblems as _mp } from '../common/providers/problems';
import { outboundFetch } from '../common/outbound-http';
import { amazonGeocodeBody, amazonSigner, parseAmazonGeocode } from '../common/providers/vendors/maps-amazon';

/**
 * Maps / geocoding adapter (Amazon Location in the target architecture, KX-08 C4). MODE=mock|real, default mock (CLAUDE.md provider rule):
 * the mock is deterministic and exercises the same code path; real mode is the pre-launch go-live pass (Docs/NEEDS_HUMAN.md "Provider go-live").
 * The provider SDK, if any, may only live under src/platform/adapters (ADR-028 / boundary test).
 */
export interface GeocodeResult { lat: number; lng: number; accuracy: 'DISTRICT' | 'ADDRESS'; provider: string }
export interface MapsAdapter {
  readonly mode: 'mock' | 'real';
  geocode(q: { governorate: string; district: string; street?: string }): Promise<GeocodeResult>;
}

/** Cairo-ish bounding box; the point is a stable fake per district, deliberately coarse (district centroid), never a real geocode. */
export class MockMapsAdapter implements MapsAdapter {
  readonly mode = 'mock' as const;
  async geocode(q: { governorate: string; district: string }): Promise<GeocodeResult> {
    const h = createHash('sha1').update(`${q.governorate}|${q.district}`).digest();
    const lat = 29.9 + (h[0] / 255) * 0.25;
    const lng = 31.15 + (h[1] / 255) * 0.35;
    return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000, accuracy: 'DISTRICT', provider: 'mock' };
  }
}

export class UnconfiguredMapsAdapter implements MapsAdapter {
  readonly mode = 'real' as const;
  async geocode(): Promise<GeocodeResult> {
    throw new Error('NEEDS_HUMAN: Amazon Location is not configured (Docs/NEEDS_HUMAN.md, Provider go-live)');
  }
}

type Env = Record<string, string | undefined>;
export const mapsProblems = _mp;

/** MAPS_MODE=real: Amazon Location Places v2 geocode over HTTPS (API key or SigV4; no SDK). Falls back to nothing: a failure surfaces as an error to the caller. */
export class AmazonMapsAdapter implements MapsAdapter {
  readonly mode = 'real' as const;
  constructor(private readonly env: Env = process.env, private readonly fetchImpl: typeof outboundFetch = outboundFetch) {}
  async geocode(q: { governorate: string; district: string; street?: string }): Promise<GeocodeResult> {
    const base = (this.env.MAPS_API_URL ?? '').replace(/\/+$/, '');
    const key = this.env.MAPS_API_KEY;
    const url = `${base}/v2/geocode${key ? `?key=${encodeURIComponent(key)}` : ''}`;
    const body = JSON.stringify(amazonGeocodeBody(q, this.env.MAPS_COUNTRY ?? 'EGY'));
    const sign = !key && this.env.MAPS_ACCESS_KEY_ID ? amazonSigner(base, this.env.MAPS_ACCESS_KEY_ID, this.env.MAPS_SECRET_ACCESS_KEY ?? '') : undefined;
    const res = await this.fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(sign ? sign({ method: 'POST', url, body }) : {}) }, body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`MAPS_PROVIDER_HTTP_${res.status}`);
    const g = parseAmazonGeocode(await res.json());
    if (!g) throw new Error('MAPS_NO_RESULT');
    return { ...g, provider: 'amazon-location' };
  }
}

export const mapsAdapter = (): MapsAdapter => (cfg().mapsMode === 'mock' ? new MockMapsAdapter() : mapsProblems().length ? new UnconfiguredMapsAdapter() : new AmazonMapsAdapter());
