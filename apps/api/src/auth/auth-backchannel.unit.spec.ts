import { AuthController } from './auth.controller';

const BCL = 'http://schemas.openid.net/event/backchannel-logout';
function setup(payload: Record<string, unknown>) {
  const calls: { revokedAll: string[]; revokedSid: string[]; enqueued: unknown[] } = { revokedAll: [], revokedSid: [], enqueued: [] };
  const ctl = new AuthController(
    { verifyLogout: async () => payload } as never,
    { revokeAllForSub: async (s: string) => { calls.revokedAll.push(s); }, revokeBySid: async (s: string) => { calls.revokedSid.push(s); } } as never,
    { enqueue: async (_c: unknown, e: unknown) => { calls.enqueued.push(e); } } as never,
    {} as never,
  );
  return { ctl, calls };
}

describe('back-channel logout: event detection', () => {
  it('Passport subject.deleted (standard event PLUS the Kiorex URI) enqueues the erasure; it used to be read as a plain session revoke', async () => {
    const { ctl, calls } = setup({ sub: 's1', events: { [BCL]: {}, 'https://schemas.kiorex.com/event/subject.deleted': {} } });
    await ctl.backchannelLogout({ logout_token: 'x' });
    expect(calls.revokedAll).toEqual(['s1']);
    expect(calls.enqueued).toEqual([expect.objectContaining({ type: 'subject.deleted', aggregateId: 's1', dedupeKey: 'subject.deleted:s1' })]);
  });
  it('a session revoke (standard event, with or without the Kiorex session URI) revokes only the session and enqueues nothing', async () => {
    const a = setup({ sid: 'sid1', events: { [BCL]: {} } });
    await a.ctl.backchannelLogout({ logout_token: 'x' });
    expect(a.calls.revokedSid).toEqual(['sid1']); expect(a.calls.enqueued).toEqual([]);
    const b = setup({ sid: 'sid2', events: { [BCL]: {}, 'https://schemas.kiorex.com/event/session.revoked': {} } });
    await b.ctl.backchannelLogout({ logout_token: 'x' });
    expect(b.calls.revokedSid).toEqual(['sid2']); expect(b.calls.enqueued).toEqual([]);
  });
  it('the legacy short key and an explicit event claim still work', async () => {
    const a = setup({ sub: 's2', events: { 'subject.deleted': {} } }); await a.ctl.backchannelLogout({ logout_token: 'x' });
    expect(a.calls.enqueued).toHaveLength(1);
    const b = setup({ sub: 's3', event: 'subject.deleted', events: { [BCL]: {} } }); await b.ctl.backchannelLogout({ logout_token: 'x' });
    expect(b.calls.enqueued).toHaveLength(1);
  });
});
