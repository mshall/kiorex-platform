import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildPath, type Locale } from './url-policy';

/**
 * Slug resolution and 301 decisions over GrowthSlug and GrowthSlugHistory (B0 tables, ARCH 4.1 rule 2). Old slugs answer 301 to the current one;
 * history is never deleted while the entity exists. The store is an interface so the decision logic is unit-tested without a database.
 */
export type SlugEntityType = 'DOCTOR' | 'CLINIC' | 'PHARMACY' | 'LAB' | 'SPECIALTY' | 'CITY' | 'DISTRICT';

export interface SlugStore {
  current(market: string, entityType: SlugEntityType, slug: string): Promise<{ entityId: string; slug: string } | null>;
  history(market: string, entityType: SlugEntityType, slug: string): Promise<{ entityId: string; replacedBy: string | null } | null>;
  currentFor(market: string, entityType: SlugEntityType, entityId: string): Promise<string | null>;
  currentForMany(market: string, entityType: SlugEntityType, entityIds: string[]): Promise<Map<string, string>>;
}

export type SlugResolution =
  | { kind: 'found'; entityId: string; slug: string }
  | { kind: 'moved'; entityId: string; slug: string }
  | { kind: 'unknown' };

/** Pure decision: current slug wins, then history (moved to whatever the entity's current slug is now), otherwise unknown. */
export async function resolveSlug(store: SlugStore, market: string, entityType: SlugEntityType, slug: string): Promise<SlugResolution> {
  const cur = await store.current(market, entityType, slug);
  if (cur) return { kind: 'found', entityId: cur.entityId, slug: cur.slug };
  const old = await store.history(market, entityType, slug);
  if (!old) return { kind: 'unknown' };
  const now = (await store.currentFor(market, entityType, old.entityId)) ?? old.replacedBy;
  if (!now || now === slug) return { kind: 'unknown' };
  return { kind: 'moved', entityId: old.entityId, slug: now };
}

@Injectable()
export class PrismaSlugStore implements SlugStore {
  constructor(private readonly prisma: PrismaService) {}
  async current(market: string, entityType: SlugEntityType, slug: string) {
    const r = await this.prisma.growthSlug.findUnique({ where: { market_entityType_slug: { market, entityType, slug } }, select: { entityId: true, slug: true } });
    return r ?? null;
  }
  async history(market: string, entityType: SlugEntityType, slug: string) {
    const r = await this.prisma.growthSlugHistory.findUnique({ where: { market_entityType_slug: { market, entityType, slug } }, select: { entityId: true, replacedBy: true } });
    return r ?? null;
  }
  async currentFor(market: string, entityType: SlugEntityType, entityId: string) {
    const r = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType, entityId } }, select: { slug: true } });
    return r?.slug ?? null;
  }
  async currentForMany(market: string, entityType: SlugEntityType, entityIds: string[]) {
    if (!entityIds.length) return new Map<string, string>();
    const rows = await this.prisma.growthSlug.findMany({ where: { market, entityType, entityId: { in: entityIds } }, select: { entityId: true, slug: true } });
    return new Map(rows.map((r) => [r.entityId, r.slug]));
  }
}

/** Facade used by the render controller: slug resolution plus the legacy /doctors/:id redirect target. */
@Injectable()
export class RedirectsService {
  constructor(private readonly store: PrismaSlugStore, private readonly prisma: PrismaService) {}

  resolve(market: string, entityType: SlugEntityType, slug: string): Promise<SlugResolution> { return resolveSlug(this.store, market, entityType, slug); }
  slugFor(market: string, entityType: SlugEntityType, entityId: string): Promise<string | null> { return this.store.currentFor(market, entityType, entityId); }
  slugsFor(market: string, entityType: SlugEntityType, entityIds: string[]): Promise<Map<string, string>> { return this.store.currentForMany(market, entityType, entityIds); }

  /** Legacy SPA URL /doctors/:id (cuid or listing id) to the canonical slug URL in the negotiated locale. null = no slug yet (the SPA shell answers). */
  async legacyDoctorTarget(id: string, locale: Locale): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(id)) return null;
    const p = await this.prisma.provider.findUnique({ where: { id }, select: { id: true, market: true, careType: true } });
    if (!p) return null;
    const slug = await this.store.currentFor(p.market, 'DOCTOR', p.id);
    if (!slug) return null;
    return buildPath(locale, p.market, p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor', { slug });
  }
}
