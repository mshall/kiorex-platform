"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.expireKey = exports.RewardLedgerService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const errors_1 = require("../../common/errors");
const ids_1 = require("../../common/ids");
const prisma_service_1 = require("../../prisma/prisma.service");
const reward_math_1 = require("./reward-math");
let RewardLedgerService = class RewardLedgerService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async lock(db, lotIds) {
        if (!lotIds.length)
            return;
        const ids = [...new Set(lotIds)].sort();
        await db.$queryRaw(client_1.Prisma.sql `SELECT "id" FROM "RewardLot" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`);
    }
    async balance(db, lotId) {
        const r = await db.$queryRaw(client_1.Prisma.sql `SELECT available, held, reserved FROM reward_lot_balance(${lotId})`);
        return { available: Number(r[0]?.available ?? 0), held: Number(r[0]?.held ?? 0), reserved: Number(r[0]?.reserved ?? 0) };
    }
    async balances(db, lotIds) {
        const out = new Map();
        const ids = [...new Set(lotIds)];
        if (!ids.length)
            return out;
        const rows = await db.$queryRaw(client_1.Prisma.sql `SELECT u."id", b.available, b.held, b.reserved FROM unnest(${ids}::text[]) AS u("id") CROSS JOIN LATERAL reward_lot_balance(u."id") b`);
        for (const r of rows)
            out.set(r.id, { available: Number(r.available ?? 0), held: Number(r.held ?? 0), reserved: Number(r.reserved ?? 0) });
        for (const id of ids)
            if (!out.has(id))
                out.set(id, { available: 0, held: 0, reserved: 0 });
        return out;
    }
    async totals(db, lotId) {
        const [b, rows] = await Promise.all([this.balance(db, lotId), db.$queryRaw(client_1.Prisma.sql `SELECT "type", SUM("amountMinor")::bigint AS s FROM "RewardLedgerEntry" WHERE "lotId" = ${lotId} GROUP BY "type"`)]);
        const t = (k) => Number(rows.find((x) => x.type === k)?.s ?? 0);
        return { ...b, issued: t('ISSUE'), redeemed: t('REDEEM'), reversed: t('REVERSE'), expired: t('EXPIRE') };
    }
    async append(db, e) {
        if (!Number.isInteger(e.amountMinor) || e.amountMinor <= 0)
            throw new errors_1.ApiError(422, 'REWARD_AMOUNT_INVALID', 'A ledger entry needs a positive whole amount in minor units');
        const id = (0, ids_1.newId)('rwe');
        const rows = await db.$queryRaw(client_1.Prisma.sql `
      INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","currency","idempotencyKey","ruleVersionId","bookingId","payLinkId","relationshipId","refundId","reasonCode","actor","createdAt")
      VALUES (${id}, ${e.lotId}, ${e.type}, ${e.amountMinor}, ${e.currency ?? 'EGP'}, ${e.idempotencyKey}, ${e.ruleVersionId}, ${e.bookingId ?? null}, ${e.payLinkId ?? null}, ${e.relationshipId ?? null}, ${e.refundId ?? null}, ${e.reasonCode}, ${e.actor}, timezone('UTC', now()))
      ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING "id"`);
        if (rows.length)
            return { created: true, id: rows[0].id };
        const prev = await db.rewardLedgerEntry.findUnique({ where: { idempotencyKey: e.idempotencyKey } });
        if (!prev || prev.lotId !== e.lotId || prev.type !== e.type || prev.amountMinor !== e.amountMinor)
            throw new errors_1.ApiError(409, 'REWARD_IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different ledger entry');
        return { created: false, id: prev.id };
    }
    async refreshStatus(db, lotId) {
        const t = await this.totals(db, lotId);
        const lot = await db.rewardLot.findUnique({ where: { id: lotId }, select: { status: true } });
        if (!lot)
            return 'MISSING';
        const status = t.held > 0 ? 'HELD' : t.expired > 0 && t.available === 0 && t.reserved === 0 ? 'EXPIRED' : t.reversed > 0 && t.available === 0 && t.reserved === 0 && t.redeemed < t.issued ? 'REVERSED' : t.available === 0 && t.reserved === 0 ? 'EXHAUSTED' : 'ACTIVE';
        if (status !== lot.status)
            await db.rewardLot.update({ where: { id: lotId }, data: { status } });
        return status;
    }
    async openLots(db, o) {
        if (!o.owners.length)
            return [];
        const rows = await db.$queryRaw(client_1.Prisma.sql `
      SELECT l."id", l."kind", l."mode", l."sub", l."ownerSub", l."funding", l."scope", l."campaignId", l."expiresAt", l."amountMinor", l."status", l."qualifyingBookingId", l."createdAt", l."couponCodeHash", b."available", b."reserved"
      FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b
      WHERE COALESCE(l."ownerSub", l."sub") = ANY(${[...o.owners]}::text[]) AND l."expiresAt" > ${o.now} AND l."status" IN ('ACTIVE') AND b."available" > 0
        ${o.mode ? client_1.Prisma.sql `AND l."mode" = ${o.mode}` : client_1.Prisma.empty}
        ${o.kinds ? client_1.Prisma.sql `AND l."kind" = ANY(${[...o.kinds]}::text[])` : client_1.Prisma.empty}
      ORDER BY l."expiresAt" ASC, l."id" ASC`);
        return rows.map((r) => ({ id: r.id, kind: r.kind, mode: r.mode, sub: r.sub, ownerSub: r.ownerSub, funding: r.funding, scope: (r.scope ?? {}), campaignId: r.campaignId, expiresAt: r.expiresAt, amountMinor: r.amountMinor, status: r.status, availableMinor: Number(r.available), reservedMinor: Number(r.reserved), qualifyingBookingId: r.qualifyingBookingId, createdAt: r.createdAt, couponCodeHash: r.couponCodeHash }));
    }
    async openReservations(db, bookingId) {
        const rows = await db.$queryRaw(client_1.Prisma.sql `
      SELECT "lotId", SUM(CASE "type" WHEN 'RESERVE' THEN "amountMinor" WHEN 'UNRESERVE' THEN -"amountMinor" WHEN 'REDEEM' THEN -"amountMinor" ELSE 0 END)::bigint AS minor
      FROM "RewardLedgerEntry" WHERE "bookingId" = ${bookingId} AND "type" IN ('RESERVE','UNRESERVE','REDEEM') GROUP BY "lotId" HAVING SUM(CASE "type" WHEN 'RESERVE' THEN "amountMinor" WHEN 'UNRESERVE' THEN -"amountMinor" WHEN 'REDEEM' THEN -"amountMinor" ELSE 0 END) > 0 ORDER BY "lotId"`);
        return rows.map((r) => ({ lotId: r.lotId, minor: Number(r.minor) }));
    }
    async redeemedFor(db, bookingId) {
        const rows = await db.$queryRaw(client_1.Prisma.sql `
      SELECT e."lotId", SUM(CASE e."type" WHEN 'REDEEM' THEN e."amountMinor" ELSE 0 END)::bigint AS minor, l."funding", l."kind", l."mode"
      FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."bookingId" = ${bookingId} AND e."type" = 'REDEEM' GROUP BY e."lotId", l."funding", l."kind", l."mode" ORDER BY e."lotId"`);
        return rows.map((r) => ({ lotId: r.lotId, minor: Number(r.minor), funding: r.funding, kind: r.kind, mode: r.mode }));
    }
};
exports.RewardLedgerService = RewardLedgerService;
exports.RewardLedgerService = RewardLedgerService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RewardLedgerService);
const expireKey = (lotId, lastEntryId, minor) => (0, reward_math_1.entryKey)('expire', lotId, lastEntryId, minor);
exports.expireKey = expireKey;
//# sourceMappingURL=reward-ledger.service.js.map