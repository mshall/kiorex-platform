/**
 * Universal Links (iOS apple-app-site-association) and Android App Links (assetlinks.json) for the Kiorex patient app, rendered from config.
 * The path lists mirror `kiorex-account/config/domains.json` appLinks.patient (a unit test asserts equality when the sibling repo is present).
 * Apple Team ID and the Play app-signing key SHA-256 fingerprint are NEEDS_HUMAN: until supplied (APPLE_TEAM_ID, ANDROID_SHA256_CERT_FINGERPRINTS)
 * the files carry the `TODO_NEEDS_HUMAN_*` placeholders and are NOT served in production (a placeholder file would only fail verification).
 */
export const PATIENT_IOS_BUNDLE_ID = 'com.kiorex.app';
export const PATIENT_ANDROID_PACKAGE = 'com.kiorex.app';
export const IOS_APP_LINK_PATHS = ['/ar/*/doctor/*', '/en/*/doctor/*', '/ar/*/clinic/*', '/en/*/clinic/*', '/ar/*/invite/*', '/en/*/invite/*', '/invite/*', '/r/*', '/q/*', '/appointment/*', '/a/*'] as const;
export const TEAM_ID_PLACEHOLDER = 'TODO_NEEDS_HUMAN_APPLE_TEAM_ID';
export const FINGERPRINT_PLACEHOLDER = 'TODO_NEEDS_HUMAN_SHA256_CERT_FINGERPRINT';

const TEAM_ID_RE = /^[A-Z0-9]{10}$/;
const SHA256_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export interface AppLinksConfig { appleTeamId?: string; androidFingerprints?: string }
export interface AppLinksResolved { teamId: string; fingerprints: string[]; teamPlaceholder: boolean; fingerprintPlaceholder: boolean }

export function resolveAppLinksConfig(c: AppLinksConfig): AppLinksResolved {
  const team = (c.appleTeamId ?? '').trim().toUpperCase();
  const fps = (c.androidFingerprints ?? '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => SHA256_RE.test(x));
  const teamOk = TEAM_ID_RE.test(team);
  return { teamId: teamOk ? team : TEAM_ID_PLACEHOLDER, fingerprints: fps.length ? fps : [FINGERPRINT_PLACEHOLDER], teamPlaceholder: !teamOk, fingerprintPlaceholder: fps.length === 0 };
}
export function appLinksConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppLinksConfig { return { appleTeamId: env.APPLE_TEAM_ID, androidFingerprints: env.ANDROID_SHA256_CERT_FINGERPRINTS }; }

export function buildAppleAppSiteAssociation(r: AppLinksResolved) {
  return { applinks: { details: [{ appIDs: [`${r.teamId}.${PATIENT_IOS_BUNDLE_ID}`], components: IOS_APP_LINK_PATHS.map((p) => ({ '/': p })) }] } };
}
export function buildAssetLinks(r: AppLinksResolved) {
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PATIENT_ANDROID_PACKAGE, sha256_cert_fingerprints: r.fingerprints } }];
}
