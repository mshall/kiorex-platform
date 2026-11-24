import { PrismaService } from '../../prisma/prisma.service';
import { INSTANCE_ID } from '../admin/growth-env';

/**
 * Propagation monitor (GRW-P1-K). Every place that READS a growth configuration reports "I am now serving version N of this kind" here; the console compares that
 * with the version in force to show how far a change has spread across instances without anyone redeploying. Writes are throttled in memory (one row per
 * instance, reader, kind and scope; refreshed at most every REFRESH_MS unless the version changed) and a failure never reaches the reader.
 */
export const READER_REFRESH_MS = 30_000;

export class ConfigReaders {
  private readonly seen = new Map<string, { versionId: string; at: number }>();
  constructor(private readonly prisma: PrismaService, private readonly instanceId: string = INSTANCE_ID) {}

  async record(reader: string, r: { kind: string; scope: string; scopeId: string; versionId: string; version: number }, now = Date.now()): Promise<void> {
    const key = `${reader}|${r.kind}|${r.scope}|${r.scopeId}`;
    const prev = this.seen.get(key);
    if (prev && prev.versionId === r.versionId && now - prev.at < READER_REFRESH_MS) return;
    this.seen.set(key, { versionId: r.versionId, at: now });
    try {
      const where = { instanceId_reader_kind_scope_scopeId: { instanceId: this.instanceId, reader, kind: r.kind, scope: r.scope, scopeId: r.scopeId } };
      const at = new Date(now);
      await this.prisma.growthConfigReader.upsert({
        where,
        create: { instanceId: this.instanceId, reader, kind: r.kind, scope: r.scope, scopeId: r.scopeId, versionId: r.versionId, version: r.version, firstLoadedAt: at, loadedAt: at, lastSeenAt: at },
        update: { versionId: r.versionId, version: r.version, lastSeenAt: at, ...(prev && prev.versionId === r.versionId ? {} : { loadedAt: at }) },
      });
    } catch { this.seen.delete(key); /* monitoring is best effort */ }
  }

  /** Readers of one (kind, scope), with the verdict against the version in force. `stale` = a reader seen recently that still serves another version. */
  async status(kind: string, scope: string, scopeId: string, inForce: { versionId: string; version: number } | null, now = new Date(), activeWithinMs = 5 * 60_000) {
    const rows = await this.prisma.growthConfigReader.findMany({ where: { kind, scope, scopeId }, orderBy: [{ reader: 'asc' }, { instanceId: 'asc' }] });
    const readers = rows.map((r) => {
      const live = now.getTime() - r.lastSeenAt.getTime() <= activeWithinMs;
      return { instanceId: r.instanceId, reader: r.reader, version: r.version, versionId: r.versionId, loadedAt: r.loadedAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), live, upToDate: inForce ? r.versionId === inForce.versionId : null };
    });
    const live = readers.filter((r) => r.live);
    return { inForceVersion: inForce?.version ?? null, readers, converged: inForce ? live.length > 0 && live.every((r) => r.upToDate) : null, stale: live.filter((r) => r.upToDate === false).length, liveReaders: live.length };
  }
}
