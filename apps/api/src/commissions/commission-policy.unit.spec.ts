import { COLLECTION_MODES } from './commission-collect';
import { COUNSEL_DEFAULT, DISCLOSURE_DEFAULT, PAYOUT_ROUTES, counselProblems, disclosureProblems, gateDecision, missingLanguages, parseCounsel, parseDisclosure, wordingSet, type CounselSignoff } from './commission-policy';

const approved = (over: Partial<CounselSignoff> = {}): CounselSignoff => ({ ...COUNSEL_DEFAULT, status: 'APPROVED', reviewerName: 'Test Counsel', documentId: 'DOC-TEST-1', reviewedOn: '2026-12-01', collectionModes: ['INVOICE_AND_COLLECT'], payoutRoutes: ['PAYMOB'], ...over });

describe('COM-3 counsel sign-off record', () => {
  it('ships NOT_REVIEWED with nothing approved: no reviewer, no document, no modes, no routes', () => {
    expect(COUNSEL_DEFAULT).toEqual({ status: 'NOT_REVIEWED', reviewerName: '', documentId: '', reviewedOn: '', conditions: '', collectionModes: [], payoutRoutes: [] });
    expect(counselProblems(COUNSEL_DEFAULT)).toEqual([]);
  });
  it('an approval needs reviewer, document id and date; conditions are mandatory for APPROVED_WITH_CONDITIONS', () => {
    expect(counselProblems({ ...COUNSEL_DEFAULT, status: 'APPROVED' }).length).toBe(3);
    expect(counselProblems(approved())).toEqual([]);
    expect(counselProblems(approved({ status: 'APPROVED_WITH_CONDITIONS' }))).toEqual(['/conditions is required for APPROVED_WITH_CONDITIONS']);
    expect(counselProblems(approved({ status: 'APPROVED_WITH_CONDITIONS', conditions: 'see document' }))).toEqual([]);
  });
  it('NOT_REVIEWED and REJECTED cannot carry approved modes or routes; unknown fields, modes, bad dates and markup are refused', () => {
    expect(counselProblems({ ...COUNSEL_DEFAULT, collectionModes: ['NET_FROM_PAYOUT'] }).length).toBe(1);
    expect(counselProblems({ ...COUNSEL_DEFAULT, status: 'REJECTED', reviewerName: 'x', payoutRoutes: ['FAWRY'] }).length).toBe(1);
    expect(counselProblems(approved({ collectionModes: ['MAGIC' as never] })).length).toBe(1);
    expect(counselProblems({ ...approved(), extra: 1 }).length).toBe(1);
    expect(counselProblems(approved({ reviewedOn: '1/12/2026' })).length).toBe(1);
    expect(counselProblems(approved({ conditions: '<b>x</b>' })).length).toBe(1);
    expect(counselProblems({ status: 'MAYBE' }).length).toBe(1);
  });
  it('parseCounsel keeps only valid values', () => { expect(parseCounsel({ status: 'APPROVED', collectionModes: ['NET_FROM_PAYOUT', 'X'], payoutRoutes: ['BANK_IPN'] })).toMatchObject({ collectionModes: ['NET_FROM_PAYOUT'], payoutRoutes: ['BANK_IPN'] }); expect(parseCounsel(null).status).toBe('NOT_REVIEWED'); });
});

describe('COM-3 the real-mode gate', () => {
  const ask = (rec: CounselSignoff | null, kind: 'COLLECTION_MODE' | 'PAYOUT_ROUTE', key: string, real = true) => gateDecision(rec, { kind, key, market: 'EG', real });
  it('mock mode is always allowed, whatever the record says', () => {
    for (const m of COLLECTION_MODES) expect(ask(null, 'COLLECTION_MODE', m, false)).toMatchObject({ allowed: true, reason: 'MOCK_MODE' });
    for (const r of PAYOUT_ROUTES) expect(ask({ ...COUNSEL_DEFAULT, status: 'REJECTED' }, 'PAYOUT_ROUTE', r, false).allowed).toBe(true);
  });
  it('default NOT_REVIEWED keeps EVERY real-money mode and route blocked with a reason', () => {
    for (const m of COLLECTION_MODES) expect(ask(null, 'COLLECTION_MODE', m)).toMatchObject({ allowed: false, reason: 'COUNSEL_NOT_REVIEWED' });
    for (const r of PAYOUT_ROUTES) expect(ask(COUNSEL_DEFAULT, 'PAYOUT_ROUTE', r)).toMatchObject({ allowed: false, reason: 'COUNSEL_NOT_REVIEWED' });
  });
  it('REJECTED blocks everything; APPROVED allows only what is listed; the lists are separate', () => {
    expect(ask({ ...COUNSEL_DEFAULT, status: 'REJECTED', reviewerName: 'x' }, 'COLLECTION_MODE', 'INVOICE_AND_COLLECT').reason).toBe('COUNSEL_REJECTED');
    expect(ask(approved(), 'COLLECTION_MODE', 'INVOICE_AND_COLLECT')).toMatchObject({ allowed: true, reason: 'APPROVED' });
    expect(ask(approved(), 'COLLECTION_MODE', 'NET_FROM_PAYOUT')).toMatchObject({ allowed: false, reason: 'NOT_IN_APPROVED_LIST' });
    expect(ask(approved(), 'PAYOUT_ROUTE', 'PAYMOB').allowed).toBe(true);
    expect(ask(approved(), 'PAYOUT_ROUTE', 'FAWRY').allowed).toBe(false);
    expect(ask(approved({ collectionModes: [] }), 'COLLECTION_MODE', 'INVOICE_AND_COLLECT').reason).toBe('NOT_IN_APPROVED_LIST');
  });
  it('APPROVED_WITH_CONDITIONS allows the listed key and carries the conditions text', () => {
    expect(ask(approved({ status: 'APPROVED_WITH_CONDITIONS', conditions: 'text from counsel' }), 'COLLECTION_MODE', 'INVOICE_AND_COLLECT')).toMatchObject({ allowed: true, reason: 'APPROVED_WITH_CONDITIONS', conditions: 'text from counsel' });
  });
});

describe('COM-3 disclosure texts', () => {
  it('ships no wording at all and hides the override reason', () => {
    expect(DISCLOSURE_DEFAULT).toEqual({ rateDisclosure: { en: '', ar: '' }, termsSummary: { en: '', ar: '' }, showOverrideReason: false });
    expect(wordingSet(DISCLOSURE_DEFAULT)).toBe(false);
    expect(disclosureProblems(DISCLOSURE_DEFAULT)).toEqual([]);
  });
  it('reports which language is still missing and treats one language as "wording set"', () => {
    const d = parseDisclosure({ rateDisclosure: { en: 'text entered by counsel', ar: '' }, showOverrideReason: true });
    expect(wordingSet(d)).toBe(true); expect(d.showOverrideReason).toBe(true);
    expect(missingLanguages(d)).toEqual({ rateDisclosure: ['ar'], termsSummary: ['en', 'ar'] });
  });
  it('refuses markup, over-long text, unknown fields and a non-boolean reason flag', () => {
    expect(disclosureProblems({ rateDisclosure: { en: '<script>x</script>' } }).length).toBe(1);
    expect(disclosureProblems({ termsSummary: { ar: 'x'.repeat(4001) } }).length).toBe(1);
    expect(disclosureProblems({ rateDisclosure: { fr: 'x' } }).length).toBe(1);
    expect(disclosureProblems({ extra: 1 }).length).toBe(1);
    expect(disclosureProblems({ showOverrideReason: 'yes' }).length).toBe(1);
  });
});
