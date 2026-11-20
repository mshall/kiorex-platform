import { createHash } from 'node:crypto';
import { cfg } from '../common/config';

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

export const mapsAdapter = (): MapsAdapter => (cfg().mapsMode === 'mock' ? new MockMapsAdapter() : new UnconfiguredMapsAdapter());
