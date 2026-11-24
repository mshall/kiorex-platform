# Deep links, app links and regional bootstrap (GRW-P1-H)

Status: As-built 24 Nov 2026 (Wave 2). Nothing is deployed; Universal Links and App Links are **not verifiable in production** until the Apple Team ID and the Play app-signing SHA-256 exist (NEEDS_HUMAN, KX-19 section 04).

## What exists
| Piece | Where |
|---|---|
| `GET /api/v1/bootstrap` (public, `Cache-Control: public, max-age=60`) | `apps/api/src/market/bootstrap.{controller,service}.ts` |
| `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` | `apps/api/src/market/app-links{,.controller}.ts` (builders also exported from `market-public.ts` for the public-site role) |
| Fallback pages `/r/:code`, `/q/:code`, `/a/:id`, `/appointment/:id` | `apps/api/src/market/link-landing{,.controller}.ts` |
| Link parameter rules (server) | `apps/api/src/market/deep-link-rules.ts` |
| Patient app link resolution, native intent handler, deferred link, claim screen | `apps/mobile/src/lib/{deepLink,deferred-link,linkRef,growthConsent,bootstrap,pendingRoute}.ts`, `app/+native-intent.tsx`, `app/r/[code].tsx`, `app/claim.tsx`, `src/hooks/useDeepLinkRouting.ts` |
| Native config | `apps/mobile/app.config.ts` (`associatedDomains`, `intentFilters`) |
| Staff app (Kiorly) | `kiorly/src/lib/deepLink.ts`, `kiorly/app/+native-intent.tsx`, `kiorly/app.config.ts` |

## Bootstrap
`GET /api/v1/bootstrap[?cc=eg]` returns `defaultMarket`, `resolvedMarket`, `liveMarkets`, `markets[] {code, currency, phoneCode, name, apiEndpoint}`, `locales`, `showMarketSelector` (true only when more than one market is live), `minAppVersion`, `apiEndpoint` and `capabilities {deepLinks, marketplace, homeVisits}` (effective flags for the resolved market). The market comes from the account or link context (`cc` hint, honoured only when live), **never from IP or any geo header**. The regional endpoint comes from the binding `REGIONAL_API_ENDPOINTS` (JSON `{"EG":"https://.../api/v1"}`, https only in production, no credentials or query); without a binding it is `PUBLIC_BASE_URL + /api/v1`. No host is hard-coded. `DEFAULT_MARKET` and `MIN_APP_VERSION` are optional env.
The patient app caches the answer for a day and uses `liveMarkets` and `defaultMarket` for link routing; the app keeps its build-time API origin until a regional roll-out switches clients to `apiEndpoint` (not done: one region today).

## Link table (patient app)
`https://kiorex.com/{ar|en}/{cc}/doctor/{slug|id}` -> doctor profile; `.../clinic/{slug}` -> search by clinic name (no clinic profile endpoint exists yet); `/r/{code}` referral or campaign (4 to 16 alphanumerics); `/q/{code}` provider link QR (8 Crockford base32, no I L O U); `/appointment/{id}` and `/a/{id}` appointment management (needs the existing sign-in, held and replayed). Custom scheme `kiorex://` accepts the same paths without the host, plus `kiorex://claim`, and keeps the existing `kiorex://auth/callback`, `kiorex://auth/logout` and `kiorex://visit-status/{token}`.

## Security rules (all tested)
- Closed route table; unknown path -> Home. No URL-valued parameter (`to`, `url`, `redirect`, `next`, `continue`, ...) is read, followed or reflected; hosts are an exact allow-list from build config; https only (http for localhost in dev builds).
- Segments must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$` after one decode with no `%` left (rejects traversal, encoded slashes, double encoding, control characters).
- A link never signs in, links or merges an account. Appointment links show nothing personal: Home decides (sign-in or tabs), then the held route is replayed.
- No token in a link; the codes are public link codes. Codes are not logged (the fallback pages log nothing and send `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `noindex`, a nonce-only CSP).
- Market-aware routing: the link `cc` wins when live, otherwise the live default market (never an error, never a selector).
- Fallback and store pages: store, web and scheme targets are built from configuration plus the validated code (`IOS_APP_STORE_URL`, `ANDROID_PLAY_STORE_URL` must be on `apps.apple.com` and `play.google.com`; `WEB_BASE_URL`; `PROVIDER_LINK_BASE_URL`). `growth.deep_links` OFF -> the page redirects (302) to the website; the well-known files stay served.

## Consent and deferred deep links
No `POST /growth/v1/touch` and no Play `referrer` parameter before the visitor presses Allow (equal-weight Not now). After Allow: one touch (`landingKind`, `ref`, `dwellMs`), the Play link gains `referrer=kxref%3D<p|r>.<code>` and the claim code appears (iOS). In the app, a link only stores a pending ref on the device (30 days); `sendPendingTouch` sends it only when growth consent is granted; the app consent state is a small local store (`growthConsent.ts`) that the consent package (GRW-P1-I) replaces through `setGrowthConsentReader`. Android reads the Play install referrer once (`expo-application` `getInstallReferrerAsync`), parses `kxref` strictly and stores a pending ref; no device fingerprinting, no advertising id, no IP. Consent wording is a draft (NEEDS_HUMAN, counsel).

## Native rebuild
`associatedDomains: applinks:kiorex.com` (iOS) and the verified `intentFilters` (Android, `autoVerify`) are native config: a new EAS build is required. `expo-application` was added to `apps/mobile/package.json`. Env: `APP_LINK_HOST` (staging build host), `EXPO_PUBLIC_LINK_HOSTS` (allow-list the app accepts, default `kiorex.com,www.kiorex.com,kiorly.link`).

## Known gaps
- Doctor slugs: the doctor screen loads by provider id (`/providers/{id}`); slug URLs from the SEO pages resolve only once the slug lookup (GRW-P1-B/F `GrowthSlug`) is exposed. Until then a slug link opens the doctor screen with a not-found state.
- Clinic profile links map to a search by name (no clinic profile endpoint).
- The `touch` endpoint itself is package B's; the fallback page and the app already send the contract body.
- Production verification of Universal Links and App Links, store URLs and the Play referrer path need the NEEDS_HUMAN items above.
