import fs from "node:fs";
import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Dynamic layer over app.json (which stays the single source for name, ids, icons and plugins). Everything that differs per environment or
 * carries credentials comes from ENV / EAS file secrets, never from the repo:
 *
 *   GOOGLE_SERVICES_JSON          path to the Firebase Android config (EAS "file" env var; locally ./config/firebase/google-services.json)
 *   GOOGLE_SERVICE_INFO_PLIST     path to the Firebase iOS config    (EAS "file" env var; locally ./config/firebase/GoogleService-Info.plist)
 *   EAS_PROJECT_ID                EAS project id (push tokens + OTA updates)
 *   EAS_UPDATES_URL               optional, https://u.expo.dev/<project id>
 *   APP_ID_SUFFIX                 optional ".dev" / ".preview" so builds install side by side (add the id to the Firebase project too)
 *   APP_NAME_SUFFIX               optional " (Dev)"
 *   EAS_BUILD_PROFILE             set by EAS: development | preview | production
 *
 * A production build without the Firebase files fails HERE with a clear message instead of shipping an app that can never register for push.
 * Placeholders are documented in config/firebase/README.md; the real files are git-ignored.
 */
// ---- GRW-P1-H: Universal Links / App Links (kept in this file: Expo's config loader cannot resolve sibling TS modules) ----
/**
 * Universal Links (iOS associated domains) and Android App Links (verified intent filters) for the patient app (GRW-P1-H).
 * The path list mirrors kiorex-account `config/domains.json` appLinks.patient and the files served at /.well-known/ (a jest test asserts it).
 * NATIVE REBUILD REQUIRED: adding or changing associatedDomains / intentFilters needs a new native build (EAS or `expo prebuild`); it cannot ship over the air.
 * Verification is NEEDS_HUMAN: the Apple Team ID (APPLE_TEAM_ID) and the Play app-signing SHA-256 must be published in the well-known files (KX-19 section 04).
 */
export const APP_LINK_HOST_DEFAULT = "kiorex.com";
/** Android `pathPattern` globs (not regex): `.` any character, `*` repeat. */
export const ANDROID_PATH_PATTERNS = ["/ar/..*/doctor/.*", "/en/..*/doctor/.*", "/ar/..*/clinic/.*", "/en/..*/clinic/.*", "/r/.*", "/q/.*", "/appointment/.*", "/a/.*"] as const;

export function appLinkHost(env: NodeJS.ProcessEnv = process.env): string {
  const h = (env.APP_LINK_HOST ?? APP_LINK_HOST_DEFAULT).trim().toLowerCase();
  return /^[a-z0-9.-]+$/.test(h) ? h : APP_LINK_HOST_DEFAULT; // a host only, never a URL
}
export const iosAssociatedDomains = (host = appLinkHost()) => [`applinks:${host}`];
export const androidIntentFilters = (host = appLinkHost()) => [
  {
    action: "VIEW",
    autoVerify: true,
    data: ANDROID_PATH_PATTERNS.map((pathPattern) => ({ scheme: "https", host, pathPattern })),
    category: ["BROWSABLE", "DEFAULT"],
  },
];

const exists = (p: string) => { try { return fs.existsSync(p); } catch { return false; } };
const pick = (envName: string, local: string): string | undefined => process.env[envName] || (exists(local) ? local : undefined);

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = process.env.EAS_BUILD_PROFILE ?? process.env.APP_ENV ?? "development";
  const idSuffix = process.env.APP_ID_SUFFIX ?? "";
  const androidFile = pick("GOOGLE_SERVICES_JSON", "./config/firebase/google-services.json");
  const iosFile = pick("GOOGLE_SERVICE_INFO_PLIST", "./config/firebase/GoogleService-Info.plist");
  if (profile === "production" && !process.env.SKIP_FIREBASE_CHECK) {
    const missing = [!androidFile && "GOOGLE_SERVICES_JSON", !iosFile && "GOOGLE_SERVICE_INFO_PLIST"].filter(Boolean);
    if (missing.length) throw new Error(`Production build needs Firebase config files: set ${missing.join(" and ")} (EAS file env vars). See config/firebase/README.md.`);
  }
  const projectId = process.env.EAS_PROJECT_ID ?? (config.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const plugins = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p : [p, undefined]) as [string, Record<string, unknown> | undefined]).map(([name, opts]) =>
    name === "expo-notifications" ? ([name, { ...(opts ?? {}), defaultChannel: "kiorex-default", enableBackgroundRemoteNotifications: true }] as [string, Record<string, unknown>]) : opts ? ([name, opts] as [string, Record<string, unknown>]) : name,
  );
  return {
    ...config,
    name: `${config.name}${process.env.APP_NAME_SUFFIX ?? ""}`,
    slug: config.slug ?? "kiorex",
    ios: { ...config.ios, associatedDomains: iosAssociatedDomains(), bundleIdentifier: `${config.ios?.bundleIdentifier}${idSuffix}`, ...(iosFile ? { googleServicesFile: iosFile } : {}), infoPlist: { ...config.ios?.infoPlist, UIBackgroundModes: ["remote-notification"] } },
    android: { ...config.android, intentFilters: androidIntentFilters(), package: `${config.android?.package}${idSuffix}`, ...(androidFile ? { googleServicesFile: androidFile } : {}), permissions: ["POST_NOTIFICATIONS", ...(config.android?.permissions ?? [])] },
    plugins: plugins as ExpoConfig["plugins"],
    ...(process.env.EAS_UPDATES_URL ? { updates: { url: process.env.EAS_UPDATES_URL } , runtimeVersion: { policy: "fingerprint" as const } } : {}),
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}), appProfile: profile },
  };
};
