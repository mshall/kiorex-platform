import { addressHash } from '../../common/privacy-hash';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WaWindowStore } from './wa-window';
import type { WaStatus, WaTemplateDef, WaTemplateStatus, WaTemplateStatusStore } from './wa-templates';

/** Window stamps by keyed address hash (the raw number is never stored here). */
export class PrismaWaWindowStore implements WaWindowStore {
  constructor(private readonly prisma: PrismaService) {}
  async lastInboundMs(phone: string, market = 'EG'): Promise<number | null> {
    const r = await this.prisma.whatsappContactWindow.findUnique({ where: { market_addressHash: { market, addressHash: addressHash(phone) } } });
    return r ? r.lastInboundAt.getTime() : null;
  }
  async touch(phone: string, atMs: number, market = 'EG'): Promise<void> {
    const h = addressHash(phone); const at = new Date(atMs);
    await this.prisma.whatsappContactWindow.upsert({ where: { market_addressHash: { market, addressHash: h } }, create: { market, addressHash: h, lastInboundAt: at }, update: {} });
    await this.prisma.whatsappContactWindow.updateMany({ where: { market, addressHash: h, lastInboundAt: { lt: at } }, data: { lastInboundAt: at } }); // forward only
  }
}

const KNOWN: WaStatus[] = ['DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'FLAGGED'];
/** Meta review events -> our status. REINSTATED and unpaused templates are APPROVED again; deletion and appeals keep the last decision. */
export function statusFromMetaEvent(event: string): WaStatus | undefined {
  switch (event) {
    case 'APPROVED': case 'REINSTATED': return 'APPROVED';
    case 'REJECTED': return 'REJECTED';
    case 'PENDING': case 'IN_APPEAL': return 'PENDING';
    case 'PAUSED': return 'PAUSED';
    case 'DISABLED': case 'PENDING_DELETION': return 'DISABLED';
    case 'FLAGGED': return 'FLAGGED';
    default: return undefined;
  }
}

export class PrismaWaTemplateStore implements WaTemplateStatusStore {
  constructor(private readonly prisma: PrismaService) {}
  async get(metaName: string, language: string): Promise<WaTemplateStatus | null> {
    const r = await this.prisma.whatsappTemplate.findUnique({ where: { metaName_language: { metaName, language } } });
    return r ? { status: (KNOWN.includes(r.status as WaStatus) ? r.status : 'DRAFT') as WaStatus, metaTemplateId: r.metaTemplateId, quality: r.quality, reason: r.reason } : null;
  }
  async apply(i: { metaName: string; language: string; status?: WaStatus; metaTemplateId?: string; quality?: string; reason?: string; at: Date }): Promise<boolean> {
    const r = await this.prisma.whatsappTemplate.findUnique({ where: { metaName_language: { metaName: i.metaName, language: i.language } } });
    if (!r) return false;
    if (r.statusAt && i.at < r.statusAt) return true; // an older event never overwrites a newer decision
    await this.prisma.whatsappTemplate.update({ where: { id: r.id }, data: { ...(i.status ? { status: i.status, statusAt: i.at } : {}), ...(i.metaTemplateId ? { metaTemplateId: i.metaTemplateId } : {}), ...(i.quality ? { quality: i.quality } : {}), ...(i.reason !== undefined ? { reason: i.reason.slice(0, 200) } : {}) } });
    return true;
  }
  async upsertDefinition(d: WaTemplateDef, status: WaStatus = 'DRAFT'): Promise<void> {
    await this.prisma.whatsappTemplate.upsert({
      where: { metaName_language: { metaName: d.metaName, language: d.language } },
      create: { key: d.key, language: d.language, metaName: d.metaName, category: d.category, status },
      update: { key: d.key, category: d.category },
    });
  }
}
