# Public site, SEO and server rendering (GRW-P1-E, GRW-P1-F)

Status: **As-built** for infrastructure (E, 24 Nov 2026) and for templates, slugs, structured data, guard rules, audit and ops API (F, 24 Nov 2026; see the section "Package F" at the end). The Arabic and English copy (titles, FAQ) is PROPOSED and needs CMO review before launch. Decisions: ADR-043 (hybrid SSR, canonical convention) and ADR-044 (frame exception for the widget host only) are **Proposed**; every default below is `PROPOSED_DEFAULT`. Nothing is deployed.

## What it is
Public pages (`/{ar|en}/{cc}/...`) are server-rendered by a **role of the existing Kiorex API image** (no Next.js, no new service). The authenticated patient SPA is unchanged and stays a SPA (its shell now carries `noindex`).

```
browser/crawler ──► CloudFront ──► /{ar,en}/*  /robots.txt  /sitemap*.xml  /.well-known/*  /_p/*  /doctors/*  ──► Kiorex API image, role site|all
                              └──► everything else ► S3 SPA (index.html, noindex)      /api/* ──► API role
```
- **Server**: `apps/api/src/public-site/*` (Nest module `PublicSiteModule`). Express handlers are mounted at the host root (not under `/api/v1`) by `SiteMounter`.
- **Renderer**: `apps/web/src/entry-server.tsx`, built to ONE self-contained CommonJS file `apps/web/dist-public/server/entry-server.cjs` (`npm run build:public -w apps/web`). The API calls `render(input)` with plain JSON it loaded itself; the bundle never fetches, never sees cookies, never sees a user.
- **Client**: `apps/web/src/entry-client.tsx` hydrates the same tree from `<script type="application/json" id="kx-public-state">` (CSP safe). Hashed assets live under `/_p/` (vite `base`).
- **Template hook**: `apps/web/src/public/registry.ts` (`registerTemplate`). E ships default templates for home, hub, city, district, care-district, doctor/nurse, clinic and not-found (`templates/default.tsx`); **package F replaces them** (or calls `registerTemplate`) without touching the server or the entries. Each template supplies `Component`, `meta()` and `jsonLd()`.
- **Thin-page guard hook**: `public-site/thin-page-guard.ts` (`registerGuard(type, fn)`), driven by the SEO growth config.

## Role and configuration (selectable, split-ready)
| Variable | Default | Meaning |
|---|---|---|
| `SITE_ROLE` | `all` | `all` API + site in one process; `api` mounts no site routes; `site` serves the site and answers 404 on `/api/v1/*` except health (set `JOBS_ENABLED=false` on a site-only service so it does not run the catalogue sync) |
| `SITE_ENVIRONMENT` | `development` | **Only `production` is indexable.** `staging`, `development` and unset: robots `Disallow: /`, no sitemap entries, `X-Robots-Tag: noindex` and `<meta robots noindex>` on every page |
| `SITE_CANONICAL_HOST` | `https://kiorex.com` | canonical host from config, **never the request Host header** (cache-poisoning rule) |
| `SITE_ENABLED` | `true` | hard off-switch (nothing mounted) |
| `SITE_SSR_BUNDLE`, `SITE_PUBLIC_CLIENT_DIR`, `SITE_SPA_SHELL` | repo-relative `apps/web/...` | locations of the bundle, hashed assets and the SPA `index.html` fallback |
| `SITE_CACHE_TTL_SECONDS` / `SITE_CACHE_MAX_ENTRIES` / `SITE_SITEMAP_TTL_SECONDS` | 60 / 500 / 300 | in-process cache tier below CloudFront |
| `SITE_RENDER_TIMEOUT_MS` | 5000 | a render slower than this falls back to the SPA shell |
| `SITE_ROOT_REDIRECT` | `false` | `GET /` 301 to `/{lang}/{cc}` (turn on only when the CDN routes `/` to this role; the SPA owns `/` for signed-in users) |
| `SITE_LEGACY_REDIRECTS` | `true` | legacy `/doctors/:id` 301 |
| `SITE_CDN_PURGE_MODE` | `mock` | `real` is NEEDS_HUMAN (distribution id, IAM role): logged as not implemented, never faked |

SEO parameters come from the `SEO` growth config (`GrowthConfigVersion`, ACTIVE MARKET then GLOBAL, else the PROPOSED_DEFAULT payload): `minLiveProviders` 3, `minUniqueBlocks` 3, `maxSiblingSimilarityPercent` 70, `sitemapShardSize` 10000, `edgeCacheSeconds` 300, `staleWhileRevalidateSeconds` 3600, `delistedGoneAfterDays` 30, `reviewMarkupEnabled`, `districtPagesEnabled`.

## URLs, canonical, hreflang
`https://kiorex.com/{ar|en}/{cc}/{type}/{slug}`, lowercase, no trailing slash, absolute, no tracking query. Route table (single source for URL building: `public-site/url-policy.ts`; mirrored for rendering in `apps/web/src/public/routes.ts`, a parity test keeps them identical):

| Page | Path after `/{locale}/{cc}` | Indexable when |
|---|---|---|
| home | `` | always |
| hub | `/doctors/{specialty}` | at least 1 LIVE provider |
| city | `/doctors/{specialty}/{city}` | guard passes |
| district | `/doctors/{specialty}/{city}/{district}` | guard passes and `districtPagesEnabled` |
| care-district | `/home-nursing/{city}/{district}`, `/physiotherapy/{city}/{district}` | guard passes and the care type is enabled (flag) |
| doctor, nurse | `/doctor/{slug}`, `/nurse/{slug}` | LIVE, listed (`clinic.kiorex_listing`), care type enabled |
| clinic | `/clinic/{slug}` | at least 1 LIVE doctor |
| city-hub, district-hub | `/locations/{city}`, `/locations/{city}/{district}` | guard passes (counts, blocks, sibling overlap, **not a copy of the parent**) |
| same-day, telemedicine | `/same-day/{specialty}`, `/telemedicine/{specialty}` | guard passes with its own availability minimum (`minAvailableProviders`) |
| pharmacy, lab | `/pharmacy/{slug}`, `/lab/{slug}` | partner registry LIVE **and** the launch-locked flag `kiorex.pharmacy_orders` / `kiorex.lab_bookings` effective, else 404 (F) |

- Canonical keeps only `page` > 1 (self-referencing); `sort`, `utm_*`, `gclid`, `fbclid`, `s`, `ref`, `lt` never change content, canonical or cache key. Page 2+ is `noindex,follow`.
- hreflang on every page and sitemap URL: `ar`, `en` (self-referencing, reciprocal, absolute) plus `x-default` (the default-locale version while one market is live; the host root once a selector exists, `rootSelector`).
- Case, trailing slash and duplicate slash variants answer **301** to the clean URL. Unknown shapes under `/{ar|en}/{cc}/` (including every private SPA name such as `account`, `appointments`) answer **404 + noindex**.
- Slugs: `GrowthSlug` resolves; `GrowthSlugHistory` answers **301 to the entity's CURRENT slug** (also after several renames). Providers without a slug (before package F's bootstrap) have no public URL and no sitemap entry; their legacy `/doctors/:id` keeps serving the SPA shell.
- Lifecycle: LIVE 200 indexable; PAUSED 200 `noindex` with the booking CTA replaced; DELISTED 301 to the specialty hub when it is indexable, else 404 and **410 after `delistedGoneAfterDays`**; unknown/never-listed 404.
- Legacy `/doctors/:id` 301 to `/{locale}/{cc}/doctor/{slug}` (locale: `kx-lang` cookie, then Accept-Language, then `ar`; response `Cache-Control: private, no-cache`, `Vary: Accept-Language, Cookie`). The public page's booking button links to `/doctors/{id}?book=1`; `book` makes the legacy route serve the SPA shell, so it can never loop.

## Robots, sitemaps, noindex
- `GET /robots.txt`: production allows `/ar/`, `/en/`, `/_p/`, `/.well-known/`, disallows every private prefix (`PRIVATE_PATH_PREFIXES`, kept in step with `App.tsx` by two tests) and references `/sitemap.xml`; any other environment is `Disallow: /`. Robots is not a privacy control: private routes also need auth and the SPA shell is `noindex`.
- `GET /sitemap.xml` (index) and `GET /sitemaps/{type}-{cc}-{locale}-{n}.xml`; types `home hub city district care-district doctor nurse clinic`; at most `sitemapShardSize` URLs per file (hard cap 50,000 and 50 MB enforced); `lastmod` = the provider's real Kiorly update time; `xhtml:link` alternates. Entries come from the **same facet table and visibility rules the renderer uses**, so a `noindex` page is never listed.
- `X-Robots-Tag: noindex` is sent on every non-indexable page (thin, paused, paginated, not found, non-production) in addition to the meta tag. The SPA shell (`apps/web/index.html`) carries `<meta name="robots" content="noindex, nofollow">`; the CloudFront response-headers policy (`spa_noindex_header`) adds the header for the S3-served routes.
- Thin-page guard (`liveProviders >= minLiveProviders`, `uniqueBlocks >= minUniqueBlocks`, sibling overlap `<= maxSiblingSimilarityPercent`); hubs need 1 LIVE provider; entity pages are gated by their status. Pages that fail get no internal navigation links.

## Caching, headers, security
- 200: `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=3600`, weak `ETag` (304 on `If-None-Match`), `Vary: Accept-Encoding` only (locale is in the path), `Content-Language`. Errors: `s-maxage=60`. Sitemaps: `s-maxage` up to 900. Cache key (CDN and in-process) = path plus `page`, `sort`.
- Headers follow ADR-038: `Content-Security-Policy` with `frame-ancestors 'none'`, `script-src 'self'` (no inline script), `style-src 'self'` plus the sha256 of the inline critical CSS, `X-Frame-Options: DENY`, HSTS, nosniff, Referrer-Policy, Permissions-Policy. The single ADR-044 exception is the widget host: only an explicit `frameAncestors` list (package G) lifts the ban, never the patient site.
- **Private data**: the render path reads no cookie, no Authorization and no session; the response is the same for everyone and never sets a cookie; the in-process cache and the CDN key never include them. The web tree may not import auth/patient/API-client/storage code (a test scans for it). Provider phone numbers, street addresses and coordinates are never in the HTML, state or JSON-LD (district coverage only for home-visit providers).
- Purge: the Kiorly webhook consumer (`PROVIDER_PROFILE_UPDATED`, `LISTING_STATUS_CHANGED`) re-syncs the catalogue, then `PublicSiteCache.onListingChanged` drops the entity pages, all list pages, the home page and the sitemap caches and asks the CDN purger for the same paths (mock until `SITE_CDN_PURGE_MODE=real`). Worst case without a purge: in-process 60 s plus CDN 300 s plus SWR; sitemaps 5 minutes: inside the 15 minute target.

## Failure behaviour (RB-G2)
- Flag `growth.ssr_public_pages` OFF (market scope) or any render error/timeout: the **SPA shell** (200, `noindex`, `Cache-Control: no-store`, header `X-Site-Fallback: FLAG_OFF|RENDER_ERROR|...`); robots and sitemaps keep working. Booking never depends on SSR. If even the shell is missing: 503 with `Retry-After`.
- `GET /_site/health` (status, role, environment, bundle and asset availability, flag state, render p50/p95/max, cache hits/misses/entries, counters such as `render_errors`, `status_404`, `cache_hit`) and `GET /_site/metrics` (Prometheus text). Both `noindex`, `no-store`; the CDN does not route `/_site/*`. `Server-Timing: ssr;dur=` and `X-Site-Cache: HIT|MISS` on pages.

## Core Web Vitals basics
Critical CSS (about 6 KB) is inlined; no render-blocking stylesheet or third-party font origin; fonts self-hosted (`apps/web/src/public/fonts`, IBM Plex Sans Arabic and Jost, SIL OFL, copied from the already-built Kiorly web assets) with `font-display: swap`, metric-matched fallbacks (`size-adjust`) and preload of the two primary faces; the hydration entry is about 94 KB gzip (budget 120); images must carry width and height (a smoke check enforces it); no layout-shifting injection (the header logo has a reserved box). Targets: lab perf >= 90, LCP <= 2.5 s mobile, CLS <= 0.1 (`apps/web/lighthouserc.json`); field p75 targets in ARCH section 5.

## Build, run, test
```bash
npm run build:site -w apps/web          # SPA (dist/) + public client + SSR bundle (dist-public/)
npm run check:public-budget -w apps/web # JS gzip, inline CSS, fonts
npm run dev:public -w apps/web          # watch-rebuild client and SSR bundle; run the API (`npm run dev -w apps/api`) and open http://localhost:4000/ar/eg
                                        # (vite dev :5180 proxies /{ar,en}/{cc}/*, /_p, robots, sitemaps to the API)
node apps/web/scripts/ssr-smoke.mjs --base http://localhost:4000 --paths /ar/eg,/en/eg/doctors/cardiology   # head tags, JSON-LD, headers, CWV hygiene; add --lighthouse when the CLI exists
npm test -w apps/web                     # meta, JSON-LD, route parity + App.tsx snapshot, SSR render, hydration (no mismatch), no-private-import scan
npm run test:unit -w apps/api            # url policy, robots, sitemap xml, headers, guard, redirects, cache, head, facets, role
npx jest --selectProjects integration --runInBand --testPathPatterns public-site   # real bundle + real database (builds the bundle when stale)
```
Slugs come from package F's bootstrap; until then insert `GrowthSlug` rows (see the integration test) to see pages.

## Infra (OpenTofu, validate only)
`modules/aws/cdn-edge` gained `site_enabled`, `site_origin_domain`, `spa_noindex_header` (all default off, so existing plans are unchanged): path-only cache policy with `page`/`sort` whitelist for the SSR namespaces, immutable `/_p/*`, uncached `/doctors/*` with `Accept-Language` and `kx-lang` forwarded, optional second origin for a split service, and a custom response-headers policy (managed security headers equivalent + `X-Robots-Tag: noindex` + frame ban) for the SPA behaviour. `modules/product-stack` passes the three inputs through. Role env (`SITE_ROLE`, `SITE_ENVIRONMENT`, `SITE_CANONICAL_HOST`) goes through `env_vars`. `tofu fmt` and `tofu validate` pass (module and product-stack); no plan, no apply.

## Docker
`apps/api/Dockerfile` builds API + SPA + public bundle into one image (`SITE_ROLE=all` default). **It did not exist in the repository although `deploy.yml` references it**; this one is proposed (modelled on the Clinic image, migrate-on-boot and DB secret in `docker-entrypoint.mjs`). The build and the two build stages were exercised with Docker; the final stage currently stops at a pre-existing `package-lock.json` integrity mismatch for the vendored `@kiorex/contracts` tarball (see NEEDS_HUMAN).

## Open items
Search Console property verification and Rich Results checks (NEEDS_HUMAN, package F checklist); real CDN invalidation; Apple Team ID and Play fingerprints (served by the market module, package H); the widget `frame-ancestors` list (package G); slug bootstrap and FAQ copy (package F, CMO review); root `/` redirect and the CDN routing of `/` (founder: second service or one, open decision 25).


## Package F: templates, slugs, structured data, audit (GRW-P1-F, As-built 24 Nov 2026)

### Slugs
`growth/seo/slug-bootstrap.service.ts` (`SlugBootstrapService.runOnce`, job every 15 min while jobs are enabled, ops `POST /ops/growth/seo/slugs/bootstrap`, `dryRun` supported) gives every LIVE or PAUSED provider (doctors, physiotherapists and nurses share the `DOCTOR` namespace), every clinic and every LIVE pharmacy or lab partner connection a slug through B's `SlugService.ensure`: Kiorly `bookingSlug` when valid, else the transliterated English name, else the transliterated Arabic name, else `<type>-<short id>`; collisions get `-2`, `-3`; idempotent; a rename (`SlugService.rename`) keeps the old slug as a 301 forever. Arabic rules (`growth/seo/arabic.ts`): a dictionary of conventional spellings (Mohamed, Abdel, Sara, Nasr City ...), honorifics dropped (`د.`, `دكتور`, `Dr`), article `ال` handled, a plain letter map for the rest. The slug is a URL token, not a translation; operators can rename.

### Pages and internal linking
Home (country page), specialty hub, specialty in city, specialty in district, care type in district (nurse, physio), **city hub** and **district hub** (all care types in a place), **same-day** and **telemedicine** hubs per specialty, doctor, nurse, clinic, pharmacy, lab, not found. Every listing derives its text from real data (count, fee range, languages, rating distribution from VISIBLE reviews, next slot, same-day count, specialty mix) and links, only to pages that pass the guard, to: parent hubs, nearby districts, other cities, related specialties and availability hubs. Doctor pages add similar providers (same specialty and city). FAQ blocks (`faq.*` keys, native `<details>`, no script, no medical claims, always the 123 pointer) are written once per template. FAQPage markup is deliberately NOT emitted (Google shows FAQ rich results only for well-known authority sites, so the markup would add risk and no value).

### Guard rules added by F
`minAvailableProviders` (same-day, telemedicine), `maxParentSimilarityPercent` (district hub vs city hub, city hub vs the whole market, same-day and telemedicine vs the specialty hub: a page that lists the same providers as its parent is a doorway and is `noindex,follow`, no navigation links, not in sitemaps; reason `PARENT_OVERLAP_AT_OR_ABOVE_<n>`). In a one-city market the city hub is therefore noindex by design (the home page carries that set). "Same day" means a next slot within `sameDayWindowHours` (24). Telemedicine lists only providers that DECLARED video in their Kiorly profile (the mock-mode default of the telemedicine module is not used). Specialty city and district pages keep E's rule (sibling overlap only), so a single-city launch still indexes `doctors/{specialty}/{city}`.

### Pagination
Self-referencing canonical per page, plain links, **no `rel=prev/next`**, page 2+ is `noindex,follow` and outside sitemaps unless the SEO config sets `paginatedIndexable` (then indexable, still outside sitemaps; page 1 is the sitemap entry).

### Versioned configuration (extension keys of the `SEO` payload)
`templates` (title and description per locale and page type, placeholders `{name} {specialty} {city} {district} {country} {clinic} {count} {fees} {rating} {where} {care} {brand}`, no markup, <= 120/320 characters, unknown placeholders rejected; a title template never contains the brand, `| Kiorex` is appended when it fits in 60 characters), `paginatedIndexable`, `reviewMarkupMinCount` (5), `sameDayWindowHours` (24), `minAvailableProviders` (2), `maxParentSimilarityPercent` (100). Resolution: ACTIVE MARKET over GLOBAL over code defaults (`seo-config.service.ts`, cached 30 s); a bad value is ignored, never applied. **Gap:** `SEO.schema.json` in kiorex-contracts still has `additionalProperties: false`, so the maker-checker write path (`validateGrowthConfig`) rejects these keys until the contract adds them as optional properties (additive, 1.11.0). Package K must call `POST /ops/growth/seo/config/validate` (or `validateSeoExtensions` from `growth/seo/seo-public.ts`) before it stores a version.

### Structured data (`apps/web/src/public/seo/jsonld.ts`)
Organization, WebSite, BreadcrumbList, CollectionPage, ItemList, Physician (physicians), Dentist, MedicalBusiness (nurses, physiotherapists, labs), MedicalClinic, Pharmacy. Never: telephone, e-mail, street address, postal code, coordinates, opening hours, price, `review` objects, `sameAs`, `medicalAudience`. Locality-level address only. `aggregateRating` only when the page shows at least one VISIBLE review, the provider has at least `reviewMarkupMinCount` reviews, the config switch `reviewMarkupEnabled` is on and the rating is rendered on the page; never fabricated. `validateJsonLd` (web test) and `jsonLdIssues` (API audit) enforce the same allow and forbid lists (a test keeps them equal).

### Images
`seo/image.ts`: https only, explicit width and height, alt text from name, specialty and place, `decoding=async`, `loading=lazy` except the single LCP image (`eager` + `fetchpriority=high`). With `SITE_IMAGE_CDN` set (an image resizer answering `GET {cdn}/image?url=&w=&f=avif|webp|jpeg`; go-live task) the doctor photo becomes a `<picture>` with AVIF and WebP sources at three widths. Without it the original is used.

### Duplicate content
One canonical per page (E), clean-URL 301s (case, trailing and duplicate slash), Arabic and underscore variants 301 once to the clean URL (`loose-path.ts`, only when the target parses; the target then applies its own 200/301/404 rules), sibling and parent overlap guard, unique titles (homonym providers get `#2`), unique FAQ and data blocks per template.

### Sitemaps, redirects, delisting
Sitemaps come from the same facet table and entity rules as the renderer (so every sitemap URL is indexable and every noindex generated page is outside them, asserted by the crawl test); pharmacies and labs are added when their gate passes. Slug history 301, delisted provider 301 to an indexable hub else 404 then 410 after `delistedGoneAfterDays` (E). Ops `GET /ops/growth/seo/redirects` lists both.

### Search Console and Bing (scaffolding, mock by default)
`public-site/search-engines.ts`. Verification from configuration: `SITE_GOOGLE_SITE_VERIFICATION` and `SITE_BING_SITE_VERIFICATION` (meta tags on the home page only, production only), `SITE_GOOGLE_VERIFICATION_FILE` (`google<hex>.html`), `SITE_BING_AUTH_USER` (`/BingSiteAuth.xml`); tokens are validated. `SearchEnginePort` (submit sitemap, pull performance) with a mock adapter (default, rows labelled `sample`) and a real adapter that refuses (`SITE_SEARCH_ENGINE_MODE=real` is NEEDS_HUMAN: property verification, OAuth or service account, Bing API key). `SitemapSubmitJob` runs daily in production only.

### Ops API (`public-site/seo-ops.controller.ts`, ops or super admin)
Read-only: `GET /ops/growth/seo/overview | pages | slugs | redirects | config | search-engines | search-engines/performance`. Idempotent audited actions: `POST rebuild` (recomputes the guard table into `GrowthLandingPage` per page and locale, drops caches), `POST slugs/bootstrap`, `POST search-engines/submit-sitemap` (mock). Hook for package K: `POST config/validate`.

### Audit and Core Web Vitals
`public-site/seo-audit.ts` (pure) is run by `test/public-site-seo.int.spec.ts`, which crawls every sitemap URL of a seeded market in CI: status, title and description length, canonical, hreflang (present, self-referencing, reciprocal, absolute, in the sitemap), robots, lang and dir, one h1, Open Graph and Twitter tags, JSON-LD (parse, allowed types, forbidden keys, rating validity, links on the host), duplicate titles and descriptions, broken internal links, image width, height and alt, one eager image, no render-blocking CSS or script, HTML size. Against a running site: `npm run seo:audit -w apps/api -- --base http://localhost:4000 --host https://kiorex.com` (exit 1 on any error). Lab scores (Lighthouse) are still NOT measured here (`lighthouserc.json` and `ssr-smoke.mjs --lighthouse` are ready).

### Tests
Web (`npm test -w apps/web`): `templates.test.tsx` (30 AR and EN structure snapshots, meta length and uniqueness, template overrides, FAQ completeness and wording, JSON-LD validity, rating policy, privacy regex over every page, pagination, images, axe on doctor, listing and home), hydration for every page type. API unit: arabic, slug names, extensions, loose paths, facets and guard, search engines, audit. API integration: `public-site-seo.int.spec.ts`.

### Manual checklist (NEEDS_HUMAN)
Search Console and Bing property verification (set the four variables above), Rich Results Test on one page per type (Physician, MedicalClinic, Pharmacy, BreadcrumbList, ItemList), sitemap submission after launch, CMO review of every `meta`, `faq.*` and template string in AR and EN, decision whether paginated pages should be indexable, image resizer for `SITE_IMAGE_CDN`, partner location fields (pharmacy and lab pages only know the name today).
