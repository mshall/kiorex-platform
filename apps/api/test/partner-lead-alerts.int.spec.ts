import { createHmac } from 'node:crypto';
import { deriveIntakeSigningKey, newIntakeNonce } from '@kiorex/contracts';
import { createCtx, TestCtx } from './harness';
import { resetLeadLimits } from '../src/partner-leads/partner-leads.service';

const LEADS = '/api/v1/partners/v1/leads';
const ALERTS = '/api/v1/admin/partner-leads';
const SECRET = 'kiorex-dev-lead-signing-secret';
let n = 0;
const org = () => `alert_org_${Date.now().toString(36)}_${++n}`;
const sign = (body: string, ts = Math.floor(Date.now() / 1000)) => ({ 'X-Kiorly-Timestamp': String(ts), 'X-Kiorly-Signature': `sha256=${createHmac('sha256', deriveIntakeSigningKey(SECRET)).update(`${ts}.${body}`).digest('hex')}`, 'content-type': 'application/json' });
const lead = (orgRef: string, extra: object = {}) => JSON.stringify({ nonce: newIntakeNonce(), kind: 'LAB', orgRef, orgName: `Alert Lab ${orgRef}`, contactName: 'Dr Alert', phone: '+201000009998', preferredTime: 'MORNING', consent: true, locale: 'en', market: 'EG', ...extra });

describe('partner lead alerts to the Kiorex team (notification layer, mock adapters)', () => {
  let c: TestCtx; let sa: { Authorization: string }; let adm: { Authorization: string }; let pat: { Authorization: string };
  const post = (body: string) => c.http().post(LEADS).set(sign(body)).send(body);
  const deliveries = (leadId: string) => c.prisma.leadAlertDelivery.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } });
  const idOf = async (o: string) => (await c.prisma.partnerLead.findFirstOrThrow({ where: { orgRef: o } })).id;
  const tok = (sub: string, roles: string[], phone: string) => c.token({ sub, roles, phone, name: sub }).then((t) => ({ Authorization: `Bearer ${t}` }));
  beforeAll(async () => {
    c = await createCtx();
    sa = await tok('ops_alert_sa', ['super_admin'], '+201000000099'); adm = await tok('ops_alert_adm', ['ops_admin'], '+201000009001'); pat = await c.as('patient_x', { roles: ['patient'] });
    await c.http().get(`${ALERTS}/alerts`).set(sa).expect(200); await c.http().get(`${ALERTS}/alerts`).set(adm).expect(200); // the ops console has seen both people
  });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await resetLeadLimits(); process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0'; await c.prisma.leadAlertConfig.deleteMany(); await c.prisma.opsStaffContact.updateMany({ data: { leadAlerts: true, channels: ['EMAIL', 'WHATSAPP', 'PUSH'] } }); });
  afterEach(() => { delete process.env.QUIET_HOURS_START; delete process.env.QUIET_HOURS_END; });

  it('lists the active team (super admin and admin only, never patients) with the settings', async () => {
    const s = (await c.http().get(`${ALERTS}/alerts`).set(sa).expect(200)).body;
    expect(s).toMatchObject({ enabled: true, channels: ['EMAIL', 'WHATSAPP', 'PUSH'], availableChannels: ['EMAIL', 'WHATSAPP', 'PUSH'] });
    expect(s.recipients.map((r: { sub: string }) => r.sub)).toEqual(expect.arrayContaining(['ops_alert_sa', 'ops_alert_adm']));
    expect(s.recipients.every((r: { roles: string[] }) => r.roles.some((x) => ['super_admin', 'ops_admin'].includes(x)))).toBe(true);
    await c.http().get(`${ALERTS}/alerts`).set(pat).expect(403);
    await c.http().get(`${ALERTS}/alerts`).expect(401);
  });

  it('a new lead alerts every active admin on each allowed channel with the AR template; no phone/email e-mail address means that channel is skipped', async () => {
    const o = org(); await post(lead(o)).expect(200); const id = await idOf(o);
    const d = await deliveries(id);
    for (const sub of ['ops_alert_sa', 'ops_alert_adm']) {
      const mine = d.filter((x) => x.staffSub === sub);
      expect(mine.find((x) => x.channel === 'WHATSAPP')?.status).toBe('SENT');
      expect(mine.find((x) => x.channel === 'PUSH')?.status).toBe('SENT');
      expect(mine.find((x) => x.channel === 'EMAIL')).toMatchObject({ status: 'SKIPPED', reason: expect.stringContaining('NO_') });
    }
    const logs = await c.prisma.messageLog.findMany({ where: { templateId: { in: ['ops.lead_alert', 'TODO_NEEDS_HUMAN_ops_lead_alert'] }, sub: 'ops_alert_sa' } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0]!.locale).toBe('ar'); expect(logs.map((l) => l.body ?? '').join(' ')).toContain(`Alert Lab ${o}`); expect(logs.map((l) => l.body ?? '').join(' ')).toContain('معمل');
    expect(logs.every((l) => !(l.body ?? '').includes('+2010000099'))).toBe(true); // no contact details of the lead travel in the alert
  });

  it('English recipients get the English copy', async () => {
    await c.prisma.opsStaffContact.update({ where: { sub: 'ops_alert_adm' }, data: { locale: 'en' } });
    const o = org(); await post(lead(o)).expect(200);
    const log = await c.prisma.messageLog.findFirstOrThrow({ where: { sub: 'ops_alert_adm', body: { contains: o } }, orderBy: { createdAt: 'desc' } });
    expect(log.locale).toBe('en'); expect(log.body).toContain('New Kiorex partner lead'); expect(log.body).toContain('(Lab)');
  });

  it('dedupes: a repeat submission and a retry never alert twice; closing then re-submitting alerts again', async () => {
    const o = org(); await post(lead(o)).expect(200); const id = await idOf(o);
    const first = (await deliveries(id)).length; expect(first).toBeGreaterThan(0);
    await post(lead(o, { contactName: 'Renamed' })).expect(200);
    expect(await deliveries(id)).toHaveLength(first);
    const sa2 = await c.get((await import('../src/partner-leads/lead-alerts.service')).LeadAlertsService);
    const row = await c.prisma.partnerLead.findUniqueOrThrow({ where: { id } });
    await sa2.onLead({ id, kind: row.kind, orgName: row.orgName }, row.createdAt); // same event again
    expect(await deliveries(id)).toHaveLength(first);
    await c.http().patch(`${ALERTS}/${id}`).set(sa).send({ status: 'CLOSED' }).expect(200);
    await post(lead(o)).expect(200);
    expect((await deliveries(id)).length).toBe(first * 2);
  });

  it('respects each person\'s opt-out and channel choice, and the global switch (super admin only)', async () => {
    await c.http().patch(`${ALERTS}/alerts/recipients/ops_alert_adm`).set(adm).send({ leadAlerts: false }).expect(200);
    await c.http().patch(`${ALERTS}/alerts/recipients/ops_alert_sa`).set(adm).expect(403); // an admin cannot change someone else
    await c.http().patch(`${ALERTS}/alerts/recipients/ops_alert_sa`).set(sa).send({ channels: ['PUSH'] }).expect(200);
    let o = org(); await post(lead(o)).expect(200);
    let d = await deliveries(await idOf(o));
    expect(d.filter((x) => x.staffSub === 'ops_alert_adm')).toHaveLength(0);
    expect(d.filter((x) => x.staffSub === 'ops_alert_sa').map((x) => x.channel)).toEqual(['PUSH']);
    await c.http().patch(`${ALERTS}/alerts`).set(adm).send({ enabled: false }).expect(403);
    await c.http().patch(`${ALERTS}/alerts`).set(sa).send({ channels: ['SMS'] }).expect(400);
    await c.http().patch(`${ALERTS}/alerts`).set(sa).send({ enabled: false }).expect(200);
    o = org(); await post(lead(o)).expect(200); d = await deliveries(await idOf(o)); expect(d).toHaveLength(0);
    await c.http().patch(`${ALERTS}/alerts`).set(sa).send({ enabled: true, channels: ['WHATSAPP'] }).expect(200);
    await c.http().patch(`${ALERTS}/alerts/recipients/ops_alert_sa`).set(sa).send({ channels: ['EMAIL', 'WHATSAPP', 'PUSH'] }).expect(200);
    o = org(); await post(lead(o)).expect(200); d = await deliveries(await idOf(o));
    expect([...new Set(d.map((x) => x.channel))]).toEqual(['WHATSAPP']);
    expect(await c.prisma.auditLog.count({ where: { action: { startsWith: 'partner_lead.alert_' } } })).toBeGreaterThanOrEqual(4);
  });

  it('holds alerts during quiet hours and sends them when the window ends', async () => {
    const local = new Date(Date.now() + 2 * 3600_000).getUTCHours(); // MARKET_TZ_OFFSET_HOURS default 2
    process.env.QUIET_HOURS_START = String(local); process.env.QUIET_HOURS_END = String((local + 3) % 24);
    const o = org(); await post(lead(o)).expect(200); const id = await idOf(o);
    const held = await deliveries(id); expect(held.length).toBeGreaterThan(0);
    expect(held.filter((x) => x.channel !== 'EMAIL').every((x) => x.status === 'SCHEDULED' && x.reason === 'QUIET_HOURS_DEFERRED' && x.scheduledFor.getTime() > Date.now())).toBe(true);
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
    await c.prisma.leadAlertDelivery.updateMany({ where: { leadId: id, status: 'SCHEDULED' }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await (c.get((await import('../src/partner-leads/lead-alerts.service')).LeadAlertsService)).processDue();
    expect((await deliveries(id)).filter((x) => x.channel === 'WHATSAPP').every((x) => x.status === 'SENT')).toBe(true);
  });

  it('the nav badge counts new leads the person has not seen and clears when they open the page', async () => {
    await c.http().post(`${ALERTS}/seen`).set(sa).expect(200);
    expect((await c.http().get(`${ALERTS}/unread`).set(sa).expect(200)).body).toEqual({ count: 0 });
    await post(lead(org())).expect(200); await post(lead(org())).expect(200);
    expect((await c.http().get(`${ALERTS}/unread`).set(sa).expect(200)).body).toEqual({ count: 2 });
    await c.http().post(`${ALERTS}/seen`).set(sa).expect(200);
    expect((await c.http().get(`${ALERTS}/unread`).set(sa).expect(200)).body).toEqual({ count: 0 });
    await c.http().get(`${ALERTS}/unread`).set(pat).expect(403);
  });
});
