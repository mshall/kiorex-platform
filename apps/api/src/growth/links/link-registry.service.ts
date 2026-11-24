import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';

export type LinkLearnResult = 'REGISTERED' | 'KNOWN' | 'CONFLICT';
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * Link code to organisation mapping (GRW-P1-C; ARCH 4.2 "a code nobody registered is ignored"). The Clinic owns link codes; Kiorex stores only
 * `GrowthAcquisitionSource(sourceKind PROVIDER_LINK, sourceRef = code, ownerOrgRef = org)`. Two ways a mapping arrives, both authenticated by the secret the two systems share:
 *  1. a Clinic-signed `lt` carries `{org, code}`: a valid signature proves the Clinic issued that pair, so the pair is registered on first use;
 *  2. the `ReferralLinkCreated` event (contract 1.10.0) when the Clinic emits it with its organisation reference (`registerFromEvent`).
 * A code can belong to one organisation only: a later claim for a different organisation is a CONFLICT and is never honoured (nothing is overwritten, evidence never moves between organisations).
 */
@Injectable()
export class LinkRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async learn(code: string, orgRef: string, market = GROWTH_DEFAULT_MARKET): Promise<LinkLearnResult> {
    const c = code.toUpperCase();
    if (!CODE.test(c) || !orgRef) return 'CONFLICT';
    const where = { market_sourceKind_sourceRef: { market, sourceKind: 'PROVIDER_LINK', sourceRef: c } };
    const found = await this.prisma.growthAcquisitionSource.findUnique({ where });
    if (found) {
      if (found.ownerOrgRef && found.ownerOrgRef !== orgRef) return 'CONFLICT';
      if (found.ownerOrgRef === orgRef) return 'KNOWN';
      await this.prisma.growthAcquisitionSource.updateMany({ where: { id: found.id, ownerOrgRef: null }, data: { ownerOrgRef: orgRef } });
      return 'REGISTERED';
    }
    try {
      await this.prisma.growthAcquisitionSource.create({ data: { market, sourceKind: 'PROVIDER_LINK', sourceRef: c, ownerOrgRef: orgRef } });
      return 'REGISTERED';
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const again = await this.prisma.growthAcquisitionSource.findUnique({ where });
      return again?.ownerOrgRef === orgRef ? 'KNOWN' : 'CONFLICT';
    }
  }

  async orgOf(code: string, market = GROWTH_DEFAULT_MARKET): Promise<string | null> {
    const src = await this.prisma.growthAcquisitionSource.findUnique({ where: { market_sourceKind_sourceRef: { market, sourceKind: 'PROVIDER_LINK', sourceRef: code.toUpperCase() } } });
    return src?.ownerOrgRef ?? null;
  }

  /** `ReferralLinkCreated` from the Clinic. The org reference is read from `data.orgRef` or `data.tenantId` when present; without one nothing can be learned. */
  async registerFromEvent(data: Record<string, unknown>): Promise<LinkLearnResult | 'IGNORED'> {
    const code = typeof data.linkCode === 'string' ? data.linkCode : '';
    const org = typeof data.orgRef === 'string' ? data.orgRef : typeof data.tenantId === 'string' ? data.tenantId : '';
    return code && org ? this.learn(code, org) : 'IGNORED';
  }
}
