import { Injectable } from '@nestjs/common';
import { FlagsService } from '../control-plane/control-plane-public';
import { MarketService } from '../market/market-public';
import { PrismaService } from '../prisma/prisma.service';

/** The light projection of one Provider row that every public listing, hub and sitemap works from (never `raw`, never contact data). */
export interface IndexedProvider {
  id: string; tenantId: string | null; clinicId: string; market: string; status: string; careType: string; profession: string | null;
  nameEn: string | null; nameAr: string | null; clinicNameEn: string | null; clinicNameAr: string | null;
  specialty: string | null; languages: string[]; governorate: string | null; area: string | null;
  minFeeMinor: number | null; maxFeeMinor: number | null; currency: string; ratingAvg: number; ratingCount: number;
  nextSlotAt: Date | null; serviceLocations: string[]; coverageDistricts: string[];
  lastModified: Date; syncedAt: Date;
  /** Provider DECLARED video visits in its Kiorly profile (never the mock-mode fallback): input of the telemedicine hubs. */
  video?: boolean;
  /** clinic.kiorex_listing effective for the provider's organisation (false = hidden from every public surface). */
  listed: boolean;
}

/** Video capability exactly as the provider declared it (same fields as TelemedicineService.isVideoCapable, without the mock-mode default). */
export function declaresVideo(raw: unknown): boolean {
  const prov = ((raw as { provider?: { telemedicine?: unknown; videoConsultation?: unknown; fees?: { modality?: string; isVideo?: boolean }[] } } | null)?.provider) ?? {};
  const declared = [prov.telemedicine, prov.videoConsultation, ...(Array.isArray(prov.fees) ? prov.fees : []).map((f) => (f?.modality === 'VIDEO' || f?.isVideo === true ? true : f?.isVideo === false ? false : undefined))].filter((x) => x !== undefined);
  return declared.length ? declared.some(Boolean) : false;
}

/** A LIVE pharmacy or lab registered as a partner connection, public name only (no contact, no keys, no registration secrets). */
export interface IndexedPartner { id: string; kind: 'PHARMACY' | 'LAB'; nameEn: string; nameAr: string | null; lastModified: Date }

export interface SiteIndex { builtAt: number; market: string; providers: IndexedProvider[]; /** LIVE partners whose feature flag is effective in the market (pharmacy orders, lab bookings). */ partners: IndexedPartner[] }

/**
 * In-memory index of the market's public providers (rebuilt at most every `ttlMs`, single-flight, dropped on a purge). It trades one bounded query
 * for O(1) hub, city, district and sitemap queries that all see the same data, so the thin-page guard and the sitemap can never disagree.
 * Scale note: fine for the launch catalogue (thousands). A catalogue beyond ~50k rows needs a SQL aggregate path (documented in Docs/SEO.md).
 */
@Injectable()
export class SiteIndexService {
  private cache = new Map<string, SiteIndex>();
  private inflight = new Map<string, Promise<SiteIndex>>();
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly markets: MarketService) {}

  invalidate(): void { this.cache.clear(); }

  async get(market: string, ttlMs = 60_000): Promise<SiteIndex> {
    const hit = this.cache.get(market);
    if (hit && Date.now() - hit.builtAt < ttlMs) return hit;
    const pending = this.inflight.get(market);
    if (pending) return pending;
    const p = this.build(market).then((i) => { this.cache.set(market, i); return i; }).finally(() => this.inflight.delete(market));
    this.inflight.set(market, p);
    return p;
  }

  private async build(market: string): Promise<SiteIndex> {
    const rows = await this.prisma.provider.findMany({
      where: { market, status: { in: ['LIVE', 'PAUSED'] } },
      select: {
        id: true, tenantId: true, clinicId: true, market: true, status: true, careType: true, profession: true, nameEn: true, nameAr: true, clinicNameEn: true, clinicNameAr: true,
        specialty: true, languages: true, governorate: true, area: true, minFeeMinor: true, maxFeeMinor: true, currency: true, ratingAvg: true, ratingCount: true, nextSlotAt: true,
        serviceLocations: true, coverageDistricts: true, sourceVersion: true, syncedAt: true, raw: true,
      },
      orderBy: { id: 'asc' },
    });
    const tenantListed = new Map<string, boolean>();
    for (const t of new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))) {
      const d = await this.flags.evaluate('clinic.kiorex_listing', { market, orgId: t });
      tenantListed.set(t, d.effective || d.reason === 'DEPENDENCY_OFF'); // same rule as catalogue search
    }
    const providers: IndexedProvider[] = rows.map((r) => {
      const v = new Date(r.sourceVersion);
      const { raw, ...rest } = r;
      return { ...rest, video: declaresVideo(raw), nextSlotAt: r.nextSlotAt, lastModified: Number.isNaN(v.getTime()) ? r.syncedAt : v, listed: r.tenantId ? tenantListed.get(r.tenantId) ?? true : true };
    });
    // pharmacies and labs: registry LIVE AND the feature flag effective (ARCH 4.1: kiorex.pharmacy_orders / kiorex.lab_bookings)
    const [pharmacyOn, labOn] = await Promise.all([this.flags.isEnabled('kiorex.pharmacy_orders', { market }).catch(() => false), this.flags.isEnabled('kiorex.lab_bookings', { market }).catch(() => false)]);
    const pcs = pharmacyOn || labOn ? await this.prisma.partnerConnection.findMany({ where: { market, status: 'LIVE', kind: { in: ['PHARMACY', 'LAB'] } }, orderBy: { id: 'asc' }, select: { id: true, kind: true, name: true, nameAr: true, updatedAt: true } }) : [];
    const partners: IndexedPartner[] = pcs.filter((x) => (x.kind === 'PHARMACY' ? pharmacyOn : labOn)).map((x) => ({ id: x.id, kind: x.kind as 'PHARMACY' | 'LAB', nameEn: x.name, nameAr: x.nameAr, lastModified: x.updatedAt }));
    return { builtAt: Date.now(), market, providers, partners };
  }

  /** Is the market live (market.<cc>.live)? Non-live markets render nothing and appear in no sitemap. */
  async marketLive(market: string): Promise<boolean> { return this.markets.isLive(market); }
  async liveMarkets(): Promise<string[]> { return this.markets.liveMarkets(); }
}
