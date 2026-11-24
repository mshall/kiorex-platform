import { Inject, Injectable, Optional } from '@nestjs/common';
import { SEO_TRIGGER, type SeoTriggerPort } from '../seo-automation/seo-automation-public';
import { PrismaService } from '../../prisma/prisma.service';
import { growthError } from '../growth-errors';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { candidateSlug, SLUG_ENTITY_TYPES, SLUG_PATTERN, withSuffix, type SlugEntityType } from './slug';

export type SlugResolution = { kind: 'CURRENT'; entityId: string; slug: string } | { kind: 'REDIRECT'; entityId: string; slug: string; to: string; status: 301 };

/**
 * Slug service with history (GRW-P1-B). Kiorex owns the SEO slug: a provider renaming their Kiorly link or profile never changes it silently.
 * `ensure` is idempotent (the same entity always keeps its slug), `rename` moves the old slug into GrowthSlugHistory so it answers 301 forever (while the
 * entity exists), and a slug that belongs to ANY entity (current or history) of the same type is never handed to another entity. Collisions get -2, -3...
 */
@Injectable()
export class SlugService {
  constructor(private readonly prisma: PrismaService, @Optional() @Inject(SEO_TRIGGER) private readonly seoTrigger?: SeoTriggerPort) {}
  private assertType(t: string): asserts t is SlugEntityType { if (!(SLUG_ENTITY_TYPES as readonly string[]).includes(t)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown slug entity type'); }

  async ensure(i: { entityType: string; entityId: string; name?: string | null; market?: string }): Promise<string> {
    this.assertType(i.entityType); const market = i.market ?? GROWTH_DEFAULT_MARKET;
    const have = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType: i.entityType, entityId: i.entityId } } });
    if (have) return have.slug;
    const base = candidateSlug(i.name, i.entityType, i.entityId);
    for (let n = 1; n < 200; n++) {
      const slug = n === 1 ? base : withSuffix(base, n);
      if (await this.taken(market, i.entityType, slug, i.entityId)) continue;
      try { return (await this.prisma.growthSlug.create({ data: { market, entityType: i.entityType, entityId: i.entityId, slug } })).slug; }
      catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
        const raced = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType: i.entityType, entityId: i.entityId } } });
        if (raced) return raced.slug; // the same entity was slugged concurrently: one slug wins
      }
    }
    throw growthError('GROWTH_INVALID_REQUEST', 'Could not find a free slug');
  }

  private async taken(market: string, type: string, slug: string, exceptEntityId: string) {
    const [cur, hist] = await Promise.all([
      this.prisma.growthSlug.findUnique({ where: { market_entityType_slug: { market, entityType: type, slug } } }),
      this.prisma.growthSlugHistory.findUnique({ where: { market_entityType_slug: { market, entityType: type, slug } } }),
    ]);
    return (!!cur && cur.entityId !== exceptEntityId) || (!!hist && hist.entityId !== exceptEntityId);
  }

  /** Renames the entity's current slug. The previous one is kept in history (301 to the new one). Returns the resulting current slug. */
  async rename(i: { entityType: string; entityId: string; newSlug: string; market?: string }): Promise<string> {
    this.assertType(i.entityType); const market = i.market ?? GROWTH_DEFAULT_MARKET;
    if (!SLUG_PATTERN.test(i.newSlug)) throw growthError('GROWTH_INVALID_REQUEST', 'A slug is 3 to 60 characters of a-z, 0-9 and hyphens');
    const cur = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType: i.entityType, entityId: i.entityId } } });
    if (!cur) throw growthError('GROWTH_INVALID_REQUEST', 'The entity has no slug yet: call ensure first');
    if (cur.slug === i.newSlug) return cur.slug;
    if (await this.taken(market, i.entityType, i.newSlug, i.entityId)) throw growthError('GROWTH_INVALID_REQUEST', 'That slug is already used by another entity (current or historic)');
    await this.prisma.$transaction(async (tx) => {
      // the entity's own old slug re-adopted: it leaves history (it is current again) while the one being replaced goes in
      await tx.growthSlugHistory.deleteMany({ where: { market, entityType: i.entityType, entityId: i.entityId, slug: i.newSlug } });
      await tx.growthSlugHistory.upsert({ where: { market_entityType_slug: { market, entityType: i.entityType, slug: cur.slug } }, create: { market, entityType: i.entityType, entityId: i.entityId, slug: cur.slug, replacedBy: i.newSlug }, update: { replacedBy: i.newSlug } });
      await tx.growthSlugHistory.updateMany({ where: { market, entityType: i.entityType, entityId: i.entityId }, data: { replacedBy: i.newSlug } }); // every older slug now points at the newest one (single hop, no chains)
      await tx.growthSlug.update({ where: { id: cur.id }, data: { slug: i.newSlug } });
    });
    this.seoTrigger?.request('slug-changed', market); // GRW-P3-F: a changed URL needs a fresh gate run (links, canonical, parity)
    return i.newSlug;
  }

  /** CURRENT slug, or a 301 to the entity's current slug, or null (404). */
  async resolve(entityType: string, slug: string, market = GROWTH_DEFAULT_MARKET): Promise<SlugResolution | null> {
    this.assertType(entityType);
    const cur = await this.prisma.growthSlug.findUnique({ where: { market_entityType_slug: { market, entityType, slug } } });
    if (cur) return { kind: 'CURRENT', entityId: cur.entityId, slug: cur.slug };
    const h = await this.prisma.growthSlugHistory.findUnique({ where: { market_entityType_slug: { market, entityType, slug } } });
    if (!h) return null;
    const now = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType, entityId: h.entityId } } });
    return now ? { kind: 'REDIRECT', entityId: h.entityId, slug, to: now.slug, status: 301 } : null; // entity gone: 404 (410 handling belongs to the SSR layer)
  }

  /** Entity removed: its slug and history may now be reused (the only moment history is deleted). */
  async release(entityType: string, entityId: string, market = GROWTH_DEFAULT_MARKET) {
    this.assertType(entityType);
    await this.prisma.$transaction([
      this.prisma.growthSlugHistory.deleteMany({ where: { market, entityType, entityId } }),
      this.prisma.growthSlug.deleteMany({ where: { market, entityType, entityId } }),
    ]);
  }
}
