import { batchPaths, CLOUDFRONT_MAX_PATHS, CloudFrontPurgeAdapter, createCdnPurgePort, MockCdnPurgeAdapter, normalisePurgePaths } from './cdn-purge.port';

describe('CDN purge port (G-22)', () => {
  it('normalises: query and fragment dropped, duplicates removed, relative and protocol-relative paths refused', () => {
    const r = normalisePurgePaths(['/ar/eg/doctor/a?x=1', '/ar/eg/doctor/a', '//evil.test/x', 'relative', '/ok path', '/sitemap.xml']);
    expect(r.paths).toEqual(['/ar/eg/doctor/a', '/sitemap.xml']); expect(r.rejected).toHaveLength(3);
  });
  it('batches at the CloudFront limit', () => {
    const many = Array.from({ length: CLOUDFRONT_MAX_PATHS * 2 + 5 }, (_, i) => `/p/${i}`);
    expect(batchPaths(many).map((b) => b.length)).toEqual([3000, 3000, 5]);
  });
  it('mock records and never sends', async () => {
    const m = new MockCdnPurgeAdapter(); const r = await m.purge(['/a', '/a', '/b?q=1']);
    expect(r).toMatchObject({ status: 'RECORDED', paths: 2, batches: 1 }); expect(m.recent[0]!.paths).toEqual(['/a', '/b']);
  });
  it('real without a distribution id or sender is NOT_CONFIGURED and sends nothing (never a fake success)', async () => {
    const send = jest.fn();
    expect((await new CloudFrontPurgeAdapter({ distributionId: null }, send as never).purge(['/a'])).status).toBe('NOT_CONFIGURED');
    expect((await new CloudFrontPurgeAdapter({ distributionId: 'E2ABCDEFGHIJK1' }).purge(['/a'])).status).toBe('NOT_CONFIGURED');
    expect((await new CloudFrontPurgeAdapter({ distributionId: 'bad id' }, send as never).purge(['/a'])).status).toBe('NOT_CONFIGURED');
    expect(send).not.toHaveBeenCalled();
  });
  it('real with a sender sends one request per batch and returns the references; a sender error is FAILED without leaking details', async () => {
    const sent: string[][] = []; let n = 0;
    const ok = new CloudFrontPurgeAdapter({ distributionId: 'E2ABCDEFGHIJK1' }, async (r) => { sent.push(r.paths); return { id: `I${++n}` }; }, () => 1);
    const r = await ok.purge(Array.from({ length: 3001 }, (_, i) => `/p/${i}`));
    expect(r).toMatchObject({ status: 'PURGED', paths: 3001, batches: 2, references: ['I1', 'I2'] }); expect(sent.map((b) => b.length)).toEqual([3000, 1]);
    const bad = await new CloudFrontPurgeAdapter({ distributionId: 'E2ABCDEFGHIJK1' }, async () => { throw new Error('arn:aws:secret'); }).purge(['/a']);
    expect(bad.status).toBe('FAILED'); expect(JSON.stringify(bad)).not.toContain('arn:aws');
  });
  it('the factory defaults to mock', () => { expect(createCdnPurgePort('mock', { distributionId: null }).mode).toBe('mock'); expect(createCdnPurgePort('real', { distributionId: null }).mode).toBe('real'); });
});
