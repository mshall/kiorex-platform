import { AuthSessionService } from './auth-session.service';

function svc(upsert: jest.Mock) {
  const prisma = { authSession: { findUnique: jest.fn().mockResolvedValue(null), upsert, update: jest.fn() } };
  return new AuthSessionService(prisma as never);
}

describe('AuthSessionService.touch', () => {
  it('creates the session row on first sight', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    await svc(upsert).touch('sub1', 'sid1', { device: 'web' });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
  it('swallows the unique-constraint race between parallel first requests (no 500 on the first screen)', async () => {
    const upsert = jest.fn().mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    await expect(svc(upsert).touch('sub1', 'sid1', {})).resolves.toBeUndefined();
  });
  it('still surfaces any other database error', async () => {
    const upsert = jest.fn().mockRejectedValue(Object.assign(new Error('connection lost'), { code: 'P1001' }));
    await expect(svc(upsert).touch('sub1', 'sid1', {})).rejects.toThrow('connection lost');
  });
});
