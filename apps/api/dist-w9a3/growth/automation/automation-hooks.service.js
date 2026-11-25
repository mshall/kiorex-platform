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
exports.AutomationHooksService = void 0;
const common_1 = require("@nestjs/common");
const ids_1 = require("../../common/ids");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const experiments_public_1 = require("../experiments/experiments-public");
const journey_runner_service_1 = require("../lifecycle/journey-runner.service");
const lifecycle_segments_1 = require("../lifecycle/lifecycle-segments");
const automation_flags_1 = require("./automation-flags");
const journey_compiler_1 = require("./journey.compiler");
const journey_graph_1 = require("./journey.graph");
const journey_validator_1 = require("./journey.validator");
const DAY = 86_400_000;
const ref = (key) => { const m = /^auto\.([a-z]{2})\.([a-z0-9-]+)$/.exec(key); return m ? { market: m[1].toUpperCase(), key: m[2] } : null; };
let AutomationHooksService = class AutomationHooksService {
    prisma;
    flags;
    exposure;
    runner;
    log = new common_1.Logger('automation-hooks');
    compiled = new Map();
    constructor(prisma, flags, exposure, runner) {
        this.prisma = prisma;
        this.flags = flags;
        this.exposure = exposure;
        this.runner = runner;
    }
    onModuleInit() { this.runner.setCustomHooks(this); }
    async find(key) {
        const r = ref(key);
        if (!r)
            return undefined;
        const row = (await this.prisma.lifecycleJourneyDefinition.findFirst({ where: { market: r.market, key: r.key, status: 'PUBLISHED' } }))
            ?? (await this.prisma.lifecycleJourneyDefinition.findFirst({ where: { market: r.market, key: r.key, status: 'RETIRED' }, orderBy: { version: 'desc' } }));
        if (!row)
            return undefined;
        const hit = this.compiled.get(row.id);
        if (hit)
            return hit;
        const v = (0, journey_validator_1.validateGraph)(row.graph);
        if (!v.valid) {
            this.log.warn(`published definition ${row.id} no longer validates: ${v.errors[0]?.code}`);
            return undefined;
        }
        const def = (0, journey_compiler_1.compileGraph)(v.graph, { definitionId: row.id, market: row.market, key: row.key, version: row.version, name: row.name }).def;
        this.compiled.set(row.id, def);
        return def;
    }
    async liveReason(def, market) {
        const row = await this.prisma.lifecycleJourneyDefinition.findUnique({ where: { id: def.custom.definitionId }, select: { status: true, killedAt: true } });
        if (!row)
            return 'RETIRED';
        if (row.killedAt)
            return 'KILLED';
        if (row.status !== 'PUBLISHED')
            return 'RETIRED';
        if (!(await this.flags.isEnabled(automation_flags_1.AUTOMATION_FLAG, { market }).catch(() => false)))
            return 'AUTOMATION_FLAG_OFF';
        return null;
    }
    async armOf(_def, experiment, sub, market) {
        const lc = await this.prisma.patientLifecycle.findFirst({ where: { sub, market }, select: { language: true, platform: true } });
        const list = await this.exposure.assignments((0, experiments_public_1.subUnit)(sub), { market, locale: lc?.language, platform: lc?.platform || undefined }, journey_graph_1.BRANCH_SURFACE);
        return list.find((a) => a.experiment === experiment)?.variant ?? 'control';
    }
    async expose(_def, experiment, sub, market) {
        const lc = await this.prisma.patientLifecycle.findFirst({ where: { sub, market }, select: { language: true, platform: true } });
        await this.exposure.expose((0, experiments_public_1.subUnit)(sub), { market, locale: lc?.language, platform: lc?.platform || undefined }, experiment);
    }
    async factsOf(sub, now) {
        const l = await this.prisma.patientLifecycle.findFirst({ where: { sub } });
        if (!l)
            return null;
        return {
            stage: l.stage, platform: l.platform, language: l.language, city: l.city, district: l.district, hasDependants: l.hasDependants, referralStatus: l.referralStatus,
            registeredDaysAgo: Math.max(0, Math.floor((now.getTime() - l.registeredAt.getTime()) / DAY)), lastBookingDaysAgo: l.lastBookingAt ? Math.max(0, Math.floor((now.getTime() - l.lastBookingAt.getTime()) / DAY)) : null,
        };
    }
    async passesSegments(segments, sub, now) {
        const f = await this.factsOf(sub, now);
        if (!f)
            return false;
        return segments.every((s) => (0, lifecycle_segments_1.inSegment)(s, f));
    }
    async sendBudget(def, sub, now) {
        const own = await this.prisma.lifecycleMessageDecision.count({ where: { sub, journeyKey: def.key, decision: 'SEND' } });
        if (own >= (def.custom?.maxSends ?? journey_graph_1.AUTOMATION_POLICY.maxSendsPerJourney))
            return 'JOURNEY_CAP';
        const recent = await this.prisma.lifecycleMessageDecision.count({ where: { sub, journeyKey: { startsWith: 'auto.' }, decision: 'SEND', at: { gte: new Date(now.getTime() - 30 * DAY) } } });
        return recent >= journey_graph_1.AUTOMATION_POLICY.maxSendsPer30Days ? 'THIRTY_DAY_CAP' : 'OK';
    }
    async count(def, kind, reason, now) {
        const day = now.toISOString().slice(0, 10);
        const id = def.custom.definitionId;
        const market = def.custom.market;
        const inc = { enrolled: kind === 'enrolled' ? 1 : 0, sent: kind === 'sent' ? 1 : 0, skipped: kind === 'skipped' ? 1 : 0, ended: kind === 'ended' ? 1 : 0 };
        await this.prisma.$executeRaw `INSERT INTO "LifecycleJourneyRunLog" ("id","definitionId","market","day","enrolled","sent","skipped","ended","byReason","updatedAt")
      VALUES (${(0, ids_1.newId)('kx_jrl')}, ${id}, ${market}, ${day}::date, ${inc.enrolled}, ${inc.sent}, ${inc.skipped}, ${inc.ended}, '{}'::jsonb, now())
      ON CONFLICT ("definitionId","day") DO UPDATE SET "enrolled" = "LifecycleJourneyRunLog"."enrolled" + ${inc.enrolled}, "sent" = "LifecycleJourneyRunLog"."sent" + ${inc.sent}, "skipped" = "LifecycleJourneyRunLog"."skipped" + ${inc.skipped}, "ended" = "LifecycleJourneyRunLog"."ended" + ${inc.ended}, "updatedAt" = now()`;
        if (reason) {
            await this.prisma.$executeRaw `UPDATE "LifecycleJourneyRunLog" SET "byReason" = jsonb_set("byReason", ARRAY[${reason}]::text[], to_jsonb(COALESCE(("byReason"->>${reason})::int, 0) + 1)) WHERE "definitionId" = ${id} AND "day" = ${day}::date`;
        }
    }
};
exports.AutomationHooksService = AutomationHooksService;
exports.AutomationHooksService = AutomationHooksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, experiments_public_1.ExposureService, journey_runner_service_1.JourneyRunnerService])
], AutomationHooksService);
//# sourceMappingURL=automation-hooks.service.js.map