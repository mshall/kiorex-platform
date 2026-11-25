"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FINGERPRINT_PLACEHOLDER = exports.TEAM_ID_PLACEHOLDER = exports.IOS_APP_LINK_PATHS = exports.PATIENT_ANDROID_PACKAGE = exports.PATIENT_IOS_BUNDLE_ID = void 0;
exports.resolveAppLinksConfig = resolveAppLinksConfig;
exports.appLinksConfigFromEnv = appLinksConfigFromEnv;
exports.buildAppleAppSiteAssociation = buildAppleAppSiteAssociation;
exports.buildAssetLinks = buildAssetLinks;
exports.PATIENT_IOS_BUNDLE_ID = 'com.kiorex.app';
exports.PATIENT_ANDROID_PACKAGE = 'com.kiorex.app';
exports.IOS_APP_LINK_PATHS = ['/ar/*/doctor/*', '/en/*/doctor/*', '/ar/*/clinic/*', '/en/*/clinic/*', '/ar/*/invite/*', '/en/*/invite/*', '/invite/*', '/r/*', '/q/*', '/appointment/*', '/a/*'];
exports.TEAM_ID_PLACEHOLDER = 'TODO_NEEDS_HUMAN_APPLE_TEAM_ID';
exports.FINGERPRINT_PLACEHOLDER = 'TODO_NEEDS_HUMAN_SHA256_CERT_FINGERPRINT';
const TEAM_ID_RE = /^[A-Z0-9]{10}$/;
const SHA256_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
function resolveAppLinksConfig(c) {
    const team = (c.appleTeamId ?? '').trim().toUpperCase();
    const fps = (c.androidFingerprints ?? '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => SHA256_RE.test(x));
    const teamOk = TEAM_ID_RE.test(team);
    return { teamId: teamOk ? team : exports.TEAM_ID_PLACEHOLDER, fingerprints: fps.length ? fps : [exports.FINGERPRINT_PLACEHOLDER], teamPlaceholder: !teamOk, fingerprintPlaceholder: fps.length === 0 };
}
function appLinksConfigFromEnv(env = process.env) { return { appleTeamId: env.APPLE_TEAM_ID, androidFingerprints: env.ANDROID_SHA256_CERT_FINGERPRINTS }; }
function buildAppleAppSiteAssociation(r) {
    return { applinks: { details: [{ appIDs: [`${r.teamId}.${exports.PATIENT_IOS_BUNDLE_ID}`], components: exports.IOS_APP_LINK_PATHS.map((p) => ({ '/': p })) }] } };
}
function buildAssetLinks(r) {
    return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: exports.PATIENT_ANDROID_PACKAGE, sha256_cert_fingerprints: r.fingerprints } }];
}
//# sourceMappingURL=app-links.js.map