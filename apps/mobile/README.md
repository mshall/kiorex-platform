# Kiorex mobile (Expo)

Patient app for iOS, Android and web, built with Expo and Expo Router. It uses the same Kiorex API and Passport sign-in (client `kiorex-mobile`, PKCE) as the web app, with Arabic and English and RTL. Back to the [platform README](../../README.md).

```bash
npm run mobile:install       # from the repo root: installs apps/mobile
npm run mobile:web           # Expo web on http://localhost:8081
npm --prefix apps/mobile run ios
npm run mobile:test && npm run mobile:typecheck
npm run gen:api --prefix apps/mobile   # regenerate API types from the OpenAPI file
```

| Folder | What |
|---|---|
| `app/` | Routes: tabs, sign-in, doctor, checkout, appointment, records, family-share, care-plans, safety, telemedicine, waitlist, services, visit-status |
| `e2e-push/` | `xcrun simctl push` payloads + `send.sh` (appointment, results, pharmacy-order, lab-booking, telemedicine) |
| `src/` | Components, hooks, API client, i18n |
| `assets/` | Icons and splash generated from the brand kit (`npm run gen:assets`) |

Never redraw the logo; assets come from the workspace `_brand` kit. Design rules: [Docs/DESIGN_SYSTEM.md](../../Docs/DESIGN_SYSTEM.md).

## Navigation and sign-out
* Pushed screens (appointment, care-plans, doctor, lab, pharmacy, records/*, results, review, safety, settings/*, telemedicine list, waitlist, family-share) live in `app/(tabs)/(more)/`: one hidden tab inside `(tabs)` with its own Stack, so the bottom tab bar stays and a back button is always there (Home fallback for deep links). URLs are unchanged. In expo-router 58 `href: null` tabs are not navigable, so the tab stays mounted with its button hidden. `checkout/[id]` (payment) and `telemedicine/room/[id]` stay full-screen on the root Stack on purpose.
* Sign out: Home header button and Account (button above the list and at the bottom) open `SignOutSheet` (confirm), which removes this device's push registration (`DELETE /me/devices/:id`), clears the session and the query cache and returns to `/sign-in`. Strings `signOutDlg.*` (ar/en).
* Offline UI check: `EXPO_PUBLIC_MOCK=1 npx expo start --web` then Continue with Passport (mock session). Expo Go 58 lacks `ExpoCrypto`, so device runs need a dev build.

## Services, family link and push taps
* **Services** (`app/(tabs)/(more)/services.tsx`, linked from Home "All services" and Account): Telemedicine, Pharmacy, Lab, Safety, Reminders cards with Available / Awaiting approval / Temporarily unavailable badges from `GET /flags/effective` (same flags as web), plus the WhatsApp booking card (steps, privacy note). The `wa.me` button shows only when `EXPO_PUBLIC_WHATSAPP_NUMBER` is set; otherwise "announced at launch". The tab bar stays visible (it is in the `(more)` stack).
* **Family visit status** (`app/visit-status/[token].tsx`, root Stack, no login): `kiorex://visit-status/<token>`. Steps timeline, ETA, provider name, stop-sharing button, gone (404 or malformed token) state. `lib/visitStatus.ts` whitelists fields, so address, fee, phone and reason can never render. The web has no universal-link / associated-domain config for `/visit-status/:token`, so only the custom scheme is registered (add `ios.associatedDomains` / Android intent filters when the domain is decided). Offline demo tokens: any token works; `gone-token` is 404, `stopped-token` is stopped.
* **Push taps** (`lib/pushRoute.ts`, `lib/pushTap.ts`, `hooks/usePushRouting.ts`): foreground, background and cold-start taps are routed from the payload under the `body` key (object or JSON string; flat data also accepted): `bookingId` -> `/appointment/:id`, `resultId` -> `/results`, `pharmacyOrderId` -> `/pharmacy/order/:id`, `labBookingId` -> `/lab/booking/:id`, `sessionId` / telemedicine template -> `/telemedicine`. Ids are validated; unknown payloads just open the app. A tap while signed out is replayed after sign-in. Simulator: `./e2e-push/send.sh appointment` (needs the dev build `com.kiorex.app`; terminate the app first to test cold start).
* Not verified on a device or simulator in this change: only Jest and `tsc`. The API's real push `data` keys for the patient app are assumed (listed above) and should be confirmed with the backend.
