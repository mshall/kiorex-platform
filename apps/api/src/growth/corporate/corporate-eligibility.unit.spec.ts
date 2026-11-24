import { evaluateEligibility, FREE_MAIL_DOMAINS, type EligibilityPolicy } from './corporate-eligibility';

const NOW = new Date('2027-02-01T10:00:00Z');
const ALL: EligibilityPolicy = { openCode: true, domainEmail: true, hrList: true };
const acct = (o = {}) => ({ status: 'ACTIVE', startsAt: new Date('2027-01-01'), endsAt: new Date('2027-12-31'), emailDomains: ['acme.com'], ...o });
const code = (o = {}) => ({ status: 'ACTIVE', kind: 'OPEN', expiresAt: null, redeemedCount: 0, maxRedemptions: 10, ...o });
const facts = (o = {}) => ({ hrListMatch: false, alreadyMember: false, ...o });
const run = (i: Partial<Parameters<typeof evaluateEligibility>[0]>) => evaluateEligibility({ policy: ALL, account: acct(), code: code(), facts: facts(), now: NOW, ...i });

describe('corporate eligibility matrix (GRW-P4-C)', () => {
  it('an open code on an active account verifies by CODE', () => expect(run({})).toEqual({ ok: true, verifiedBy: 'CODE' }));
  it.each([['PAUSED'], ['LEAD'], ['ENDED']])('a %s account is never eligible', (status) => expect(run({ account: acct({ status }) })).toEqual({ ok: false, reason: 'ACCOUNT_NOT_ACTIVE' }));
  it('outside the contract dates is not eligible (not started, already ended)', () => {
    expect(run({ account: acct({ startsAt: new Date('2027-03-01') }) })).toEqual({ ok: false, reason: 'ACCOUNT_NOT_ACTIVE' });
    expect(run({ account: acct({ endsAt: new Date('2027-02-01T10:00:00Z') }) })).toEqual({ ok: false, reason: 'ACCOUNT_NOT_ACTIVE' });
  });
  it('a person already in a programme cannot join a second one', () => expect(run({ facts: facts({ alreadyMember: true }) })).toEqual({ ok: false, reason: 'ALREADY_MEMBER' }));
  it('a revoked, expired or exhausted code is refused with its own reason', () => {
    expect(run({ code: code({ status: 'REVOKED' }) })).toEqual({ ok: false, reason: 'CODE_REVOKED' });
    expect(run({ code: code({ expiresAt: new Date('2027-01-31') }) })).toEqual({ ok: false, reason: 'CODE_EXPIRED' });
    expect(run({ code: code({ redeemedCount: 10 }) })).toEqual({ ok: false, reason: 'CODE_EXHAUSTED' });
  });
  it('a LIST code needs an HR list match and the list policy; an OPEN code needs the open-code policy', () => {
    expect(run({ code: code({ kind: 'LIST' }) })).toEqual({ ok: false, reason: 'NOT_ON_HR_LIST' });
    expect(run({ code: code({ kind: 'LIST' }), facts: facts({ hrListMatch: true }) })).toEqual({ ok: true, verifiedBy: 'HR_LIST' });
    expect(run({ code: code({ kind: 'LIST' }), facts: facts({ hrListMatch: true }), policy: { ...ALL, hrList: false } })).toEqual({ ok: false, reason: 'HR_LIST_OFF' });
    expect(run({ policy: { ...ALL, openCode: false } })).toEqual({ ok: false, reason: 'OPEN_CODES_OFF' });
  });
  it('the domain path needs a VERIFIED e-mail on a domain the account lists', () => {
    const d = (f: object, a = {}, p = ALL) => run({ code: null, facts: facts(f), account: acct(a), policy: p });
    expect(d({ email: 'sara@acme.com', emailVerified: true })).toEqual({ ok: true, verifiedBy: 'DOMAIN_EMAIL' });
    expect(d({ email: 'sara@ACME.com', emailVerified: true })).toEqual({ ok: true, verifiedBy: 'DOMAIN_EMAIL' });
    expect(d({ email: 'sara@acme.com', emailVerified: false })).toEqual({ ok: false, reason: 'EMAIL_NOT_VERIFIED' });
    expect(d({ email: 'sara@acme.com' })).toEqual({ ok: false, reason: 'EMAIL_NOT_VERIFIED' });
    expect(d({ emailVerified: true })).toEqual({ ok: false, reason: 'EMAIL_NOT_VERIFIED' });
    expect(d({ email: 'sara@other.com', emailVerified: true })).toEqual({ ok: false, reason: 'EMAIL_DOMAIN_MISMATCH' });
    expect(d({ email: 'sara@sub.acme.com', emailVerified: true })).toEqual({ ok: false, reason: 'EMAIL_DOMAIN_MISMATCH' });
    expect(d({ email: 'sara@acme.com', emailVerified: true }, {}, { ...ALL, domainEmail: false })).toEqual({ ok: false, reason: 'NO_VERIFICATION_PATH' });
  });
  it('a free-mail domain can never prove employment, even if ops typed it into the account', () => {
    for (const dom of FREE_MAIL_DOMAINS) expect(run({ code: null, facts: facts({ email: `x@${dom}`, emailVerified: true }), account: acct({ emailDomains: [dom] }) })).toEqual({ ok: false, reason: 'EMAIL_DOMAIN_MISMATCH' });
  });
});
