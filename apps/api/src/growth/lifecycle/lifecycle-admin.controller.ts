import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, Post, Query, forwardRef } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { badRequest, notFound } from '../../common/errors';
import { addressHash } from '../../common/privacy-hash';
import { EngagementService, render, TEMPLATES, templateClassView, type NotifyKind } from '../../engagement/engagement-public';
import { channelMode } from '../../messaging/messaging-public';
import { SuppressionService } from '../../patient/patient-public';
import { PrismaService } from '../../prisma/prisma.service';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { GROWTH_FLAG } from '../growth-flags';
import { JourneyRunnerService } from './journey-runner.service';
import { LifecycleJob } from './lifecycle.job';
import { LifecyclePolicyService } from './lifecycle-policy.service';
import { LifecycleStateService } from './lifecycle-state.service';
import { SendGateService } from './send-gate.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;

class AddSuppressionDto { @IsString() @MinLength(3) @MaxLength(120) address!: string; @IsIn(['WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'ALL']) channel!: string; @IsString() @MinLength(8) @MaxLength(300) note!: string }
class LiftRequestDto { @IsString() @MinLength(8) @MaxLength(500) evidence!: string }
class TestSendDto { @IsString() kind!: string; @IsIn(['INAPP', 'WHATSAPP', 'SMS', 'EMAIL', 'PUSH']) channel!: string; @IsOptional() @IsString() @MaxLength(120) sub?: string }

/**
 * Lifecycle console API (GRW-P2-E). Reads: every Growth ops role, aggregate only (decision counts by reason, funnel counts with k >= 10), never a per-person drill-down except the audited lookup by
 * subject for the DPO. Writes: super admin (journey policy changes go through the LIFECYCLE_POLICY maker-checker, not through here). Lifting a suppression needs two different people and written evidence.
 */
@ApiTags('growth-lifecycle')
@Roles(...rolesFor('read'))
@Controller('admin/growth/lifecycle')
export class LifecycleAdminController {
  constructor(
    private readonly prisma: PrismaService, private readonly policies: LifecyclePolicyService, private readonly state: LifecycleStateService, private readonly runner: JourneyRunnerService,
    @Inject(forwardRef(() => SuppressionService)) private readonly suppression: SuppressionService, @Inject(forwardRef(() => EngagementService)) private readonly engagement: EngagementService, private readonly job: LifecycleJob, private readonly gate: SendGateService,
  ) {}

  @Get() @ApiOperation({ summary: 'GRW-P2-E journeys with their steps, class, policy state and active enrolments; the policy in force' }) @ApiOkResponse(OBJ)
  async overview(@Query('market') market = 'EG') {
    const policy = await this.policies.resolve(market);
    const active = await this.prisma.lifecycleEnrollment.findMany({ where: { state: 'ACTIVE', market }, select: { journeyKey: true } });
    const count = (key: string) => active.filter((a) => a.journeyKey === key || a.journeyKey.startsWith(`${key}#`)).length;
    return {
      market, flags: { lifecycleJourneys: await this.policies.journeysOn(market), marketingMessaging: await this.policies.marketingOn(market) },
      policy: { version: policy.version, source: policy.source, caps: policy.caps, quietHours: policy.quiet, holdoutBps: policy.holdoutBps },
      journeys: this.policies.catalogue().map((j) => ({
        key: j.key, trigger: j.trigger, anchored: j.anchored, describe: j.describe, enabled: this.policies.journeyPolicy(policy, j).enabled, activeEnrolments: count(j.key),
        hasMarketingStep: j.steps.some((s) => s.messageClass === 'MARKETING'),
        steps: j.steps.map((s) => ({ step: s.step, messageClass: s.messageClass, channels: s.channels, kind: s.kind, delayMinutes: s.delayMinutes })),
      })),
    };
  }

  @Get('funnel') @ApiOperation({ summary: 'GRW-P2-E stage funnel; a stage with fewer than 10 people shows no count' }) @ApiOkResponse(ARR)
  funnel(@Query('market') market = 'EG') { return this.state.funnel(market, 10); }

  @Get('decisions') @ApiOperation({ summary: 'GRW-P2-E send-gate decisions by journey, decision and reason code over the last N days (aggregate)' }) @ApiOkResponse(ARR)
  async decisions(@Query('days') daysRaw = '7', @Query('market') market = 'EG') {
    const days = Math.max(1, Math.min(90, Number(daysRaw) || 7));
    const rows = await this.prisma.lifecycleMessageDecision.groupBy({ by: ['journeyKey', 'messageClass', 'decision', 'reason'], where: { market, at: { gte: new Date(Date.now() - days * 86_400_000) } }, _count: { _all: true }, orderBy: [{ journeyKey: 'asc' }] });
    return rows.map((r) => ({ journeyKey: r.journeyKey, messageClass: r.messageClass, decision: r.decision, reason: r.reason, count: r._count._all }));
  }

  @Get('templates') @ApiOperation({ summary: 'GRW-P2-E template catalogue: class badge, purpose, copy review state, AR and EN preview with sample parameters' }) @ApiOkResponse(ARR)
  templates() {
    const sample = { doctor: 'Dr. Sample', time: 'Mon 9:00', date: '1 Jan', minutes: 10, assignee: 'Sample', patient: 'Sample', count: 3, org: 'Sample', kindLabel: 'Clinic', link: 'https://kiorex.com', status: 'Updated' } as Record<string, unknown>;
    return templateClassView().map((v) => ({ ...v, templateId: TEMPLATES[v.kind].templateId, en: render(TEMPLATES[v.kind].en, sample), ar: render(TEMPLATES[v.kind].ar, sample) }));
  }

  @Get('suppressions') @ApiOperation({ summary: 'GRW-P2-E suppression list (channel, reason, source, hash tail; never the address)' }) @ApiOkResponse(ARR)
  async suppressions(@Query('active') active?: string, @Query('take') take = '100') {
    const rows = await this.prisma.communicationSuppression.findMany({ where: active === '0' ? {} : { liftedAt: null }, orderBy: { createdAt: 'desc' }, take: Math.min(200, Number(take) || 100) });
    return rows.map((r) => ({ id: r.id, market: r.market, channel: r.channel, reason: r.reason, source: r.source, createdAt: r.createdAt, liftedAt: r.liftedAt, hashTail: r.addressHash.slice(-6) }));
  }

  @Roles(...rolesFor('manage')) @Post('suppressions') @ApiOperation({ summary: 'GRW-P2-E add a manual suppression (reason MANUAL, a written note is required, audited)' }) @ApiOkResponse(OBJ)
  async addSuppression(@CurrentUser() u: AuthUser, @Body() b: AddSuppressionDto) {
    const row = await this.suppression.add({ address: b.address, channel: b.channel, reason: 'MANUAL', source: `ops:${u.sub}` });
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.suppression.add', resource: 'CommunicationSuppression', resourceId: row.id, metadata: { channel: b.channel, note: b.note } } });
    return { id: row.id, channel: row.channel, reason: row.reason, hashTail: row.addressHash.slice(-6) };
  }

  @Roles(...rolesFor('manage')) @Post('suppressions/:id/lift-request') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-E first person: ask to lift a suppression, with documented consent evidence' }) @ApiOkResponse(OBJ)
  async liftRequest(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: LiftRequestDto) {
    const row = await this.prisma.communicationSuppression.findUnique({ where: { id } });
    if (!row || row.liftedAt) throw notFound('SUPPRESSION_NOT_FOUND', 'No active suppression with this id');
    const a = await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.suppression.lift_requested', resource: 'CommunicationSuppression', resourceId: id, metadata: { evidence: b.evidence } } });
    return { requestId: a.id, state: 'AWAITING_SECOND_PERSON' };
  }

  @Roles(...rolesFor('manage')) @Post('suppressions/:id/lift-approve') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-E second person (never the requester): lift the suppression' }) @ApiOkResponse(OBJ)
  async liftApprove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const req = await this.prisma.auditLog.findFirst({ where: { resource: 'CommunicationSuppression', resourceId: id, action: 'growth.lifecycle.suppression.lift_requested' }, orderBy: { createdAt: 'desc' } });
    if (!req) throw badRequest('LIFT_NOT_REQUESTED', 'Nobody asked to lift this suppression yet');
    if (req.actor === u.sub) throw new ForbiddenException({ code: 'GROWTH_CONFIG_SELF_APPROVAL', message: 'The person who asked cannot approve it' });
    const r = await this.prisma.communicationSuppression.updateMany({ where: { id, liftedAt: null }, data: { liftedAt: new Date() } });
    if (!r.count) throw notFound('SUPPRESSION_NOT_FOUND', 'No active suppression with this id');
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.suppression.lifted', resource: 'CommunicationSuppression', resourceId: id, metadata: { requestedBy: req.actor, requestId: req.id } } });
    return { lifted: true };
  }

  @Roles(...rolesFor('manage')) @RequiresFlag(GROWTH_FLAG.LIFECYCLE_JOURNEYS) @Post('test-send') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-E send one template to an allowlisted staff subject, only while the channel runs in mock mode' }) @ApiOkResponse(OBJ)
  async testSend(@CurrentUser() u: AuthUser, @Body() b: TestSendDto) {
    if (!(b.kind in TEMPLATES)) throw badRequest('UNKNOWN_TEMPLATE', 'Unknown template kind');
    if (b.channel !== 'INAPP' && channelMode(b.channel as 'WHATSAPP' | 'SMS' | 'EMAIL' | 'PUSH') !== 'mock') throw new ForbiddenException({ code: 'TEST_SEND_MOCK_ONLY', message: 'Test sends only run while the channel is in mock mode' });
    const allow = (process.env.LIFECYCLE_TEST_SUBS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const sub = b.sub ?? allow[0];
    if (!sub || !allow.includes(sub)) throw new ForbiddenException({ code: 'TEST_SEND_NOT_ALLOWLISTED', message: 'The recipient is not on the staff test allowlist (LIFECYCLE_TEST_SUBS)' });
    const ids = await this.engagement.notify(sub, { kind: b.kind as NotifyKind, params: {}, dedupeKey: `lc-test:${u.sub}:${Date.now()}`, channels: [b.channel], exact: true });
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.test_send', resource: 'Message', resourceId: ids[0] ?? null, metadata: { kind: b.kind, channel: b.channel } } });
    return { messageIds: ids };
  }

  @Get('lookup') @ApiOperation({ summary: 'GRW-P2-E audited lookup of one subject decisions (DPO use): every call writes an audit row' }) @ApiOkResponse(ARR)
  async lookup(@CurrentUser() u: AuthUser, @Query('sub') sub: string) {
    if (!sub || sub.length > 120) throw new BadRequestException('sub is required');
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'growth.lifecycle.lookup', resource: 'LifecycleMessageDecision', metadata: { subHash: addressHash(sub).slice(0, 12) } } });
    return this.prisma.lifecycleMessageDecision.findMany({ where: { sub }, orderBy: { at: 'desc' }, take: 100, select: { journeyKey: true, step: true, messageClass: true, channel: true, templateKey: true, decision: true, reason: true, at: true } });
  }

  @Roles(...rolesFor('manage')) @RequiresFlag(GROWTH_FLAG.LIFECYCLE_JOURNEYS) @Post('run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-E run the one-minute tick once (idempotent; also what the job does)' }) @ApiOkResponse(OBJ)
  run() { return this.job.runOnce(); }
}
