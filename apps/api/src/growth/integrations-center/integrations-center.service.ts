import { Injectable, Optional } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { COUNSEL_GATE_PORT, type CounselGatePort } from '../../common/counsel-gate-port';
import { conflict, badRequest } from '../../common/errors';
import { createMessagingAdapter, maskRecipient, type MsgChannel } from '../../messaging/messaging-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthConfigService } from '../config/growth-config.service';
import { growthError } from '../growth-errors';
import { IntegrationService } from '../integrations/integration.service';
import { policyNow } from '../policy/policy-registry';
import { INTEGRATIONS, INTEGRATION_KEYS, envPresence, integrationByKey, type IntegrationDef, type IntegrationKey, type Mode } from './integration-registry';

type Env = Record<string, string | undefined>;
const SECRETISH = /(KEY|SECRET|TOKEN|JSON)/;
export type Drift = 'NONE' | 'APPROVED_NOT_DEPLOYED' | 'REAL_NOT_APPROVED';

/**
 * Integrations Control Center (founder's single place to see and switch every real integration). Reads the deployed environment through the SAME helpers as the startup gate
 * (so it cannot disagree with /health/providers), reports names and booleans only, never a value. A mode switch is NOT an env edit: it is a proposal that goes through the maker-checker
 * (`INTEGRATION_MODES`, second super admin approves); the page then shows DRIFT between the approved mode and what is deployed. Checks and test sends never reach a vendor in this build.
 */
@Injectable()
export class IntegrationsCenterService {
  constructor(private readonly prisma: PrismaService, private readonly growth: IntegrationService, private readonly config: GrowthConfigService, @Optional() @Inject(COUNSEL_GATE_PORT) private readonly counsel?: CounselGatePort) {}

  private approvedModes(): Partial<Record<IntegrationKey, Mode>> { return (policyNow<{ modes?: Partial<Record<IntegrationKey, Mode>> }>('INTEGRATION_MODES').modes ?? {}); }

  async overview(market: string, env: Env = process.env) {
    const gs = await this.growth.status(market).catch(() => ({ integrations: [] as Array<Record<string, any>> }));
    const growthByKind = new Map<string, Record<string, any>>((gs.integrations as Array<Record<string, any>>).map((g) => [g.kind as string, g]));
    const approved = this.approvedModes();
    const checks = await this.lastChecks();
    const pending = await this.prisma.growthConfigVersion.findFirst({ where: { kind: 'INTEGRATION_MODES', scope: 'GLOBAL', scopeId: '', status: { in: ['DRAFT', 'PENDING_APPROVAL'] } }, orderBy: { version: 'desc' }, select: { id: true, status: true, payload: true, createdBy: true, createdAt: true } });
    const assistantMode = await this.config.resolve<{ model?: { mode?: string } }>('ASSISTANT_POLICY', { market }).then((r) => r.payload?.model?.mode ?? 'mock').catch(() => 'mock');
    const rows = INTEGRATIONS.map((d) => this.row(d, env, growthByKind.get(d.growthKind ?? ''), approved, checks.get(d.key), assistantMode));
    // COM-3: the funds-flow counsel sign-off of this market gates the payment rails (and the commission collection modes) in REAL mode; mock is always allowed
    const counsel = this.counsel ? await this.counsel.state(market).catch(() => null) : null;
    if (counsel) for (const r of rows) {
      if (r.group !== 'payments') continue;
      const g = counsel.gates.find((x) => x.kind === 'PAYOUT_ROUTE' && x.key === r.key);
      (r as Record<string, unknown>).counselGate = g ? { allowed: g.allowed, reason: g.reason, status: g.status } : null;
    }
    return {
      generatedAt: new Date().toISOString(), market,
      summary: { total: rows.length, real: rows.filter((r) => r.mode === 'real').length, mock: rows.filter((r) => r.mode === 'mock').length, unobservable: rows.filter((r) => r.mode === null).length, drift: rows.filter((r) => r.drift !== 'NONE').length, notReady: rows.filter((r) => r.mode === 'real' && !r.ready).length },
      approvedModes: approved, pendingProposal: pending ? { id: pending.id, status: pending.status, modes: (pending.payload as { modes?: unknown }).modes ?? {}, createdBy: pending.createdBy, createdAt: pending.createdAt.toISOString() } : null,
      integrations: rows,
      counsel: counsel ? { market: counsel.market, status: counsel.counsel.record.status, reviewedOn: counsel.counsel.record.reviewedOn || null, realBlocked: counsel.realBlocked, gates: counsel.gates.map((g) => ({ kind: g.kind, key: g.key, allowed: g.allowed, reason: g.reason })), page: '/commission-policy' } : null,
      rules: { secrets: 'Only variable names and whether each is set. No value is ever returned.', switching: 'A switch to real is a maker-checker change (INTEGRATION_MODES); this page never edits the environment.', checks: 'A connection check validates configuration and answers mock-safe; it makes no call to a vendor in this build.' },
    };
  }

  private row(d: IntegrationDef, env: Env, g: Record<string, any> | undefined, approved: Partial<Record<IntegrationKey, Mode>>, last: { at: string; ok: boolean; detail: string; by: string } | undefined, assistantMode: string) {
    let mode: Mode | null = d.modeOf(env);
    if (d.growthKind && !d.testSend && g) mode = g.mode === 'real' ? 'real' : 'mock'; // marketing kinds: the INTEGRATION config version decides
    if (d.key === 'LLM_ASSISTANT') mode = assistantMode === 'real' && d.requiredEnv.every((k) => !!(env[k] ?? '').trim()) ? 'real' : 'mock';
    const presence = envPresence(d, env);
    const problems = [...d.problems(env), ...(d.key === 'LLM_ASSISTANT' && assistantMode === 'real' ? presence.filter((p) => p.required && !p.set).map((p) => `${p.name} is required when ASSISTANT_POLICY.model.mode=real`) : [])];
    const secretNames = presence.filter((p) => p.required && SECRETISH.test(p.name));
    const secretRefSet = g && !d.testSend ? !!g.secretRefSet : secretNames.every((p) => p.set);
    const approvedMode = approved[d.key] ?? 'mock';
    const drift: Drift = mode === null ? 'NONE' : mode === 'real' && approvedMode !== 'real' ? 'REAL_NOT_APPROVED' : mode !== 'real' && approvedMode === 'real' ? 'APPROVED_NOT_DEPLOYED' : 'NONE';
    const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
    return {
      key: d.key, group: d.group, label: d.label, owner: d.owner, observable: d.observable, mode, approvedMode, drift,
      secretRefSet, ready: mode !== 'real' ? true : problems.length === 0 && (g && !d.testSend ? !!g.secretRefSet : presence.filter((p) => p.required).every((p) => p.set)),
      problems, env: presence,
      circuit: g ? { state: g.circuit as string, consecutiveFailures: g.consecutiveFailures as number, lastOkAt: g.lastOkAt as string | null, lastErrorAt: g.lastErrorAt as string | null, source: d.testSend ? 'analytics pull' : 'pull jobs' } : null,
      lastRun: g?.lastRun ?? null,
      lastCheck: last ?? null,
      webhook: d.webhook ? { path: d.webhook.path, url: base ? `${base}${d.webhook.path.replace(/^\/api\/v1/, '/api/v1')}` : null, verifyTokenEnv: d.webhook.verifyTokenEnv ?? null, verifyTokenSet: d.webhook.verifyTokenEnv ? !!(env[d.webhook.verifyTokenEnv] ?? '').trim() : null, secretEnv: d.webhook.secretEnv ?? null, secretSet: d.webhook.secretEnv ? !!(env[d.webhook.secretEnv] ?? '').trim() : null, note: d.webhook.note ?? null } : null,
      growthKind: d.growthKind ?? null, testSend: d.testSend ?? null,
      runbook: `${d.runbook.file}#${d.runbook.anchor}`, needsHuman: d.needsHuman, note: d.note ?? null,
    };
  }

  private async lastChecks(): Promise<Map<string, { at: string; ok: boolean; detail: string; by: string }>> {
    const out = new Map<string, { at: string; ok: boolean; detail: string; by: string }>();
    const rows = await this.prisma.auditLog.findMany({ where: { action: 'integration.check', resource: 'Integration' }, orderBy: { createdAt: 'desc' }, take: 200 }).catch(() => []);
    for (const r of rows) if (!out.has(r.resourceId ?? '')) { const m = (r.metadata ?? {}) as { ok?: boolean; detail?: string }; out.set(r.resourceId ?? '', { at: r.createdAt.toISOString(), ok: !!m.ok, detail: String(m.detail ?? ''), by: r.actor }); }
    return out;
  }

  /** Mock-safe connection check: configuration only. Real mode names the missing or invalid variables; mock mode answers a synthetic OK. Never calls a vendor. */
  async check(key: string, actor: string, market: string, env: Env = process.env) {
    const d = this.def(key);
    const ov = await this.overview(market, env); const r = ov.integrations.find((x) => x.key === d.key)!;
    let ok: boolean; let detail: string;
    if (r.mode === null) { ok = false; detail = 'NOT_OBSERVABLE: this integration runs in another deployment; verify it there (see the runbook)'; }
    else if (r.mode === 'mock') { ok = true; detail = 'MOCK_OK: synthetic adapter answers; nothing was sent to a vendor'; }
    else { ok = r.ready; detail = ok ? 'CONFIG_OK: required variables present and valid; no call was made to the vendor' : `CONFIG_PROBLEMS: ${[...r.problems, ...r.env.filter((e) => e.required && !e.set).map((e) => `${e.name} is not set`)].slice(0, 12).join('; ')}`; }
    await this.prisma.auditLog.create({ data: { actor, action: 'integration.check', resource: 'Integration', resourceId: d.key, metadata: { ok, mode: r.mode, detail } as never } });
    return { key: d.key, ok, mode: r.mode, detail, checkedAt: new Date().toISOString() };
  }

  /** Adapter-level test send. Mock mode only: a real test send needs an allow-listed recipient the founder names (runbook), so it is refused here. */
  async testSend(key: string, actor: string, to: string, market: string, env: Env = process.env) {
    const d = this.def(key);
    if (!d.testSend) throw badRequest('TEST_SEND_NOT_APPLICABLE', 'This integration has no test send');
    if (!/^[+\w.@:-]{3,64}$/.test(to)) throw badRequest('INVALID_RECIPIENT', 'Recipient looks malformed');
    const r = (await this.overview(market, env)).integrations.find((x) => x.key === d.key)!;
    if (r.mode === 'real') throw conflict('TEST_SEND_REAL_NOT_ALLOWED', 'Real test sends are done by the go-live runbook with an allow-listed recipient, not from this page');
    const adapter = createMessagingAdapter(d.testSend as MsgChannel);
    const res = await adapter.send({ to, body: 'Kiorex Integrations Control Center test', templateId: 'CONTROL_CENTER_TEST', locale: 'en', subject: 'Kiorex test', channel: d.testSend as MsgChannel, messageId: `cc-${Date.now()}` } as never);
    await this.prisma.auditLog.create({ data: { actor, action: 'integration.test_send', resource: 'Integration', resourceId: d.key, metadata: { to: maskRecipient(d.testSend as MsgChannel, to), ok: res.ok, mode: 'mock' } as never } });
    return { key: d.key, ok: res.ok, mode: 'mock' as const, providerRef: res.providerRef, error: res.error ?? null, to: maskRecipient(d.testSend as MsgChannel, to) };
  }

  /** The only way to ask for a different mode: a maker-checker DRAFT of INTEGRATION_MODES, submitted at once; a different super admin approves it in the config console. */
  async proposeMode(actor: { sub: string; roles: string[] }, key: string, mode: string, reason: string) {
    const d = this.def(key);
    if (mode !== 'mock' && mode !== 'real') throw growthError('GROWTH_INVALID_REQUEST', 'mode must be mock or real');
    if ((reason ?? '').trim().length < 10) throw growthError('GROWTH_INVALID_REQUEST', 'A reason of at least 10 characters is required (it becomes the announcement)');
    const next = { modes: { ...this.approvedModes(), [d.key]: mode } };
    const draft = await this.config.createDraft(actor, { kind: 'INTEGRATION_MODES', scope: 'GLOBAL', payload: next, reason: reason.trim(), announcement: reason.trim() });
    const sub = await this.config.submit(actor, draft.id);
    return { id: sub.id, status: sub.status, key: d.key, mode, approveAt: '/growth/config' };
  }

  private def(key: string): IntegrationDef { const d = integrationByKey(key); if (!d) throw growthError('GROWTH_INVALID_REQUEST', `Unknown integration ${key}`); return d; }
  keys(): readonly string[] { return INTEGRATION_KEYS; }
}
