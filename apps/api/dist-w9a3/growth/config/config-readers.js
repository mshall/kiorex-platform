"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigReaders = exports.READER_REFRESH_MS = void 0;
const growth_env_1 = require("../admin/growth-env");
exports.READER_REFRESH_MS = 30_000;
class ConfigReaders {
    prisma;
    instanceId;
    seen = new Map();
    constructor(prisma, instanceId = growth_env_1.INSTANCE_ID) {
        this.prisma = prisma;
        this.instanceId = instanceId;
    }
    async record(reader, r, now = Date.now()) {
        const key = `${reader}|${r.kind}|${r.scope}|${r.scopeId}`;
        const prev = this.seen.get(key);
        if (prev && prev.versionId === r.versionId && now - prev.at < exports.READER_REFRESH_MS)
            return;
        this.seen.set(key, { versionId: r.versionId, at: now });
        try {
            const where = { instanceId_reader_kind_scope_scopeId: { instanceId: this.instanceId, reader, kind: r.kind, scope: r.scope, scopeId: r.scopeId } };
            const at = new Date(now);
            await this.prisma.growthConfigReader.upsert({
                where,
                create: { instanceId: this.instanceId, reader, kind: r.kind, scope: r.scope, scopeId: r.scopeId, versionId: r.versionId, version: r.version, firstLoadedAt: at, loadedAt: at, lastSeenAt: at },
                update: { versionId: r.versionId, version: r.version, lastSeenAt: at, ...(prev && prev.versionId === r.versionId ? {} : { loadedAt: at }) },
            });
        }
        catch {
            this.seen.delete(key);
        }
    }
    async status(kind, scope, scopeId, inForce, now = new Date(), activeWithinMs = 5 * 60_000) {
        const rows = await this.prisma.growthConfigReader.findMany({ where: { kind, scope, scopeId }, orderBy: [{ reader: 'asc' }, { instanceId: 'asc' }] });
        const readers = rows.map((r) => {
            const live = now.getTime() - r.lastSeenAt.getTime() <= activeWithinMs;
            return { instanceId: r.instanceId, reader: r.reader, version: r.version, versionId: r.versionId, loadedAt: r.loadedAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), live, upToDate: inForce ? r.versionId === inForce.versionId : null };
        });
        const live = readers.filter((r) => r.live);
        return { inForceVersion: inForce?.version ?? null, readers, converged: inForce ? live.length > 0 && live.every((r) => r.upToDate) : null, stale: live.filter((r) => r.upToDate === false).length, liveReaders: live.length };
    }
}
exports.ConfigReaders = ConfigReaders;
//# sourceMappingURL=config-readers.js.map