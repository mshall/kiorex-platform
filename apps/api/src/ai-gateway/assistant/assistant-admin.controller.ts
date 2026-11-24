import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { notFound } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { ASSISTANT_FLAG } from './assistant.growth-bridge';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantAudit } from './assistant.audit';
import { AssistantPolicyService } from './assistant.config';
import { AssistantCostService } from './assistant.cost.service';
import { AssistantEscalationService } from './assistant.escalation.service';
import { AssistantModelFactory } from './assistant.model.factory';
import { AssistantSessionService } from './assistant.session.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
const READ = ['super_admin', 'ops_admin', 'finance', 'support'];
const HUMAN = ['super_admin', 'support']; // transcripts and escalations: the people who answer patients
const K_MIN = 10;
const num = (v: unknown, d: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : d; };

/**
 * GRW-P2-D ops API (Growth, WhatsApp assistant pages). Reads: every Growth ops role, with no phone number or subject anywhere in a response. Transcripts: support and super admin only, redacted text, every view
 * audited. Escalation acknowledge and close are never behind a flag (a patient is waiting for a person). The breaker reset is super admin only.
 */
@ApiTags('growth-assistant')
@Roles(...READ)
@Controller('admin/growth/assistant')
export class AssistantAdminController {
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly policies: AssistantPolicyService, private readonly cost: AssistantCostService, private readonly escalations: AssistantEscalationService,
    private readonly sessions: AssistantSessionService, private readonly audit: AssistantAudit, private readonly models: AssistantModelFactory) {}

  @Get('status') @ApiOperation({ summary: 'GRW-P2-D assistant mode, gate status, budgets and breaker' }) @ApiOkResponse(OBJ)
  async status(@Query('market') market = DEFAULT_MARKET) {
    const policy = await this.policies.get(market);
    const chain = await this.models.get(policy, market);
    const [a, r] = await Promise.all([this.flags.evaluate(ASSISTANT_FLAG.ASSISTANT, { market }), this.flags.evaluate(ASSISTANT_FLAG.REAL_MODEL, { market })]);
    const day = this.cost.dayKey();
    const usage = await this.prisma.assistantUsageDaily.findUnique({ where: { day_market: { day, market } } });
    const open = await this.prisma.assistantEscalation.count({ where: { status: { in: ['OPEN', 'ACKED'] } } });
    const overdue = await this.prisma.assistantEscalation.count({ where: { status: { in: ['OPEN', 'ACKED'] }, slaDueAt: { lt: new Date() } } });
    return {
      market, mode: chain.mode, model: chain.name, policy: { source: policy.source, versionId: policy.versionId, retentionDays: policy.retentionDays, escalationSlaMinutes: policy.escalationSlaMinutes, model: policy.model },
      flags: { assistant: { key: ASSISTANT_FLAG.ASSISTANT, effective: a.effective, reason: a.reason, blockedBy: a.blockedBy ?? null }, realModel: { key: ASSISTANT_FLAG.REAL_MODEL, effective: r.effective, reason: r.reason } },
      realModelConfigured: !!(process.env.ASSISTANT_BASE_URL && process.env.ASSISTANT_MODEL && process.env.ASSISTANT_API_KEY), // booleans only: never a value
      usageToday: { tokens: usage?.tokens ?? 0, costMinor: usage?.costMinor ?? 0, conversations: usage?.conversations ?? 0, breakerTripped: usage?.breakerTripped ?? false }, budgets: policy.budgets, rateLimits: policy.rateLimits,
      escalations: { open, overdue },
    };
  }

  @Get('conversations') @ApiOperation({ summary: 'GRW-P2-D assistant conversations (no phone, no subject)' }) @ApiOkResponse(ARR)
  async conversations(@Query('state') state?: string, @Query('limit') limit?: string, @Query('market') market = DEFAULT_MARKET) {
    const rows = await this.prisma.assistantSession.findMany({ where: { market, ...(state ? { state } : {}) }, orderBy: { createdAt: 'desc' }, take: num(limit, 50, 200), include: { escalations: { select: { id: true, status: true } } } });
    return rows.map((s) => ({ id: s.id, createdAt: s.createdAt, state: s.state, language: s.language, turns: s.turns, tokens: s.tokenBudgetUsed, costMinor: s.costMinorUsed, verified: !!s.sub, escalated: s.escalations.length > 0, escalationStatus: s.escalations[0]?.status ?? null, expiresAt: s.expiresAt }));
  }

  @Roles(...HUMAN) @Get('conversations/:id') @ApiOperation({ summary: 'GRW-P2-D redacted transcript of one conversation (view is audited)' }) @ApiOkResponse(OBJ)
  async conversation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const s = await this.prisma.assistantSession.findUnique({ where: { id } });
    if (!s) throw notFound('ASSISTANT_SESSION_NOT_FOUND', 'Conversation not found');
    await this.audit.record('transcript_viewed', id, { actor: u.sub }, u.sub);
    const turns = await this.sessions.transcript(id);
    const calls = await this.prisma.assistantToolCall.findMany({ where: { turn: { sessionId: id } }, orderBy: { createdAt: 'asc' }, take: 100, select: { tool: true, argsRedacted: true, resultKind: true, createdAt: true } });
    return { id: s.id, state: s.state, language: s.language, verified: !!s.sub, createdAt: s.createdAt, turns, toolCalls: calls };
  }

  @Get('escalations') @ApiOperation({ summary: 'GRW-P2-D escalation queue with SLA timers' }) @ApiOkResponse(ARR)
  async escalationList(@Query('status') status?: string) {
    const rows = await this.prisma.assistantEscalation.findMany({ where: status ? { status } : { status: { in: ['OPEN', 'ACKED'] } }, orderBy: { slaDueAt: 'asc' }, take: 100 });
    const now = Date.now();
    return rows.map((e) => ({ id: e.id, sessionId: e.sessionId, reason: e.reason, status: e.status, ackBy: e.ackBy, createdAt: e.createdAt, slaDueAt: e.slaDueAt, overdue: e.status !== 'CLOSED' && e.slaDueAt.getTime() < now, minutesLeft: Math.round((e.slaDueAt.getTime() - now) / 60_000), closedAt: e.closedAt }));
  }
  @Roles(...HUMAN) @Get('escalations/:id') @ApiOperation({ summary: 'GRW-P2-D escalation with its redacted transcript (view is audited)' }) @ApiOkResponse(OBJ)
  async escalation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const e = await this.prisma.assistantEscalation.findUnique({ where: { id } });
    if (!e) throw notFound('ASSISTANT_ESCALATION_NOT_FOUND', 'Escalation not found');
    await this.audit.record('transcript_viewed', e.sessionId, { actor: u.sub, escalationId: id }, u.sub);
    return { id: e.id, sessionId: e.sessionId, reason: e.reason, status: e.status, slaDueAt: e.slaDueAt, transcript: e.transcript };
  }
  @Roles(...HUMAN) @Post('escalations/:id/ack') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-D acknowledge an escalation' }) @ApiOkResponse(OBJ)
  async ack(@CurrentUser() u: AuthUser, @Param('id') id: string) { return { acked: await this.escalations.ack(id, u.sub) }; }
  @Roles(...HUMAN) @Post('escalations/:id/close') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-D close an escalation; the assistant answers the next message again' }) @ApiOkResponse(OBJ)
  async close(@CurrentUser() u: AuthUser, @Param('id') id: string) { if (!(await this.escalations.close(id, u.sub))) throw notFound('ASSISTANT_ESCALATION_NOT_FOUND', 'Escalation not found or already closed'); return { closed: true }; }

  @Get('budgets') @ApiOperation({ summary: 'GRW-P2-D budgets, today usage and the last 14 days' }) @ApiOkResponse(OBJ)
  async budgets(@Query('market') market = DEFAULT_MARKET) {
    const policy = await this.policies.get(market);
    const days = await this.prisma.assistantUsageDaily.findMany({ where: { market }, orderBy: { day: 'desc' }, take: 14 });
    return { market, budgets: policy.budgets, rateLimits: policy.rateLimits, days: days.map((d) => ({ day: d.day.toISOString().slice(0, 10), tokens: d.tokens, costMinor: d.costMinor, conversations: d.conversations, breakerTripped: d.breakerTripped })) };
  }
  @Roles('super_admin') @Post('budgets/reset-breaker') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-D reset the daily cost breaker (super admin, audited)' }) @ApiOkResponse(OBJ)
  async reset(@CurrentUser() u: AuthUser, @Query('market') market = DEFAULT_MARKET) { await this.cost.reset(market, u.sub); return { reset: true }; }

  @Get('metrics') @ApiOperation({ summary: 'GRW-P2-D containment, handoff, completion, cost per booking, p95 latency; masked below k = 10 conversations' }) @ApiOkResponse(OBJ)
  async metrics(@Query('days') days?: string, @Query('market') market = DEFAULT_MARKET) {
    const since = new Date(Date.now() - num(days, 30, 365) * 86_400_000);
    const sessions = await this.prisma.assistantSession.count({ where: { market, createdAt: { gte: since } } });
    if (sessions < K_MIN) return { masked: true, k: K_MIN, sessions: null, containmentRate: null, handoffRate: null, bookingCompletionRate: null, costPerBookingMinor: null, p95LatencyMs: null };
    const handed = await this.prisma.assistantSession.count({ where: { market, createdAt: { gte: since }, escalations: { some: {} } } });
    const booked = await this.prisma.assistantSession.count({ where: { market, createdAt: { gte: since }, turnRows: { some: { toolCalls: { some: { tool: 'confirm_booking', resultKind: 'OK:BOOK' } } } } } });
    const agg = await this.prisma.assistantSession.aggregate({ _sum: { costMinorUsed: true }, where: { market, createdAt: { gte: since } } });
    const p = await this.prisma.$queryRaw<{ p95: number | null }[]>`SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95 FROM "AssistantTurn" t JOIN "AssistantSession" s ON s.id = t."sessionId" WHERE t.direction = 'OUT' AND s.market = ${market} AND t."createdAt" >= ${since}`;
    const r = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);
    return { masked: false, k: K_MIN, sessions, containmentRate: r(sessions - handed, sessions), handoffRate: r(handed, sessions), bookingCompletionRate: r(booked, sessions), costPerBookingMinor: booked >= K_MIN ? Math.round((agg._sum.costMinorUsed ?? 0) / booked) : null, p95LatencyMs: p[0]?.p95 != null ? Math.round(Number(p[0].p95)) : null };
  }
}
