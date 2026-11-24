import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAppleAppSiteAssociation, buildAssetLinks, FINGERPRINT_PLACEHOLDER, IOS_APP_LINK_PATHS, resolveAppLinksConfig, TEAM_ID_PLACEHOLDER } from './app-links';

const FP = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');

describe('app link association files (GRW-P1-H)', () => {
  it('without config both files carry the NEEDS_HUMAN placeholders', () => {
    const r = resolveAppLinksConfig({});
    expect(r).toMatchObject({ teamPlaceholder: true, fingerprintPlaceholder: true });
    expect(buildAppleAppSiteAssociation(r).applinks.details[0]!.appIDs).toEqual([`${TEAM_ID_PLACEHOLDER}.com.kiorex.app`]);
    expect(buildAssetLinks(r)[0]!.target.sha256_cert_fingerprints).toEqual([FINGERPRINT_PLACEHOLDER]);
  });
  it('valid Team ID and fingerprints are used; malformed values fall back to the placeholder', () => {
    const ok = resolveAppLinksConfig({ appleTeamId: 'abcde12345', androidFingerprints: `${FP}, ${FP.toLowerCase()}` });
    expect(ok).toMatchObject({ teamId: 'ABCDE12345', teamPlaceholder: false, fingerprintPlaceholder: false });
    expect(ok.fingerprints).toEqual([FP, FP]);
    const bad = resolveAppLinksConfig({ appleTeamId: 'TEAM/../ID', androidFingerprints: 'AA:BB,not-a-fingerprint' });
    expect(bad).toMatchObject({ teamPlaceholder: true, fingerprintPlaceholder: true });
  });
  it('paths are a closed list: never the whole host, always a locale+market doctor or clinic path or a short link prefix', () => {
    const comps = buildAppleAppSiteAssociation(resolveAppLinksConfig({})).applinks.details[0]!.components.map((c) => c['/']);
    expect(comps).toEqual([...IOS_APP_LINK_PATHS]);
    expect(comps).not.toContain('/*');
    for (const p of comps) expect(p).toMatch(/^\/(ar\/\*\/(doctor|clinic)\/\*|en\/\*\/(doctor|clinic)\/\*|r\/\*|q\/\*|appointment\/\*|a\/\*)$/);
  });
  it('mirrors kiorex-account config/domains.json and the template files when the sibling repo is present', () => {
    const dir = join(__dirname, '../../../../../kiorex-account/config');
    if (!existsSync(join(dir, 'domains.json'))) return;
    const d = JSON.parse(readFileSync(join(dir, 'domains.json'), 'utf8')).appLinks.patient;
    expect(d.iosPaths).toEqual([...IOS_APP_LINK_PATHS]);
    expect(d.iosBundleId).toBe('com.kiorex.app');
    const tpl = JSON.parse(readFileSync(join(dir, 'app-links/apple-app-site-association.kiorex.json'), 'utf8'));
    expect(tpl.applinks).toEqual(buildAppleAppSiteAssociation(resolveAppLinksConfig({})).applinks);
    const al = JSON.parse(readFileSync(join(dir, 'app-links/assetlinks.kiorex.json'), 'utf8'));
    expect(al).toEqual(buildAssetLinks(resolveAppLinksConfig({})));
  });
});
