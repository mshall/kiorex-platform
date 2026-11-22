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
| `app/` | Routes: tabs, sign-in, doctor, checkout, appointment, records, family-share, care-plans, safety, telemedicine, waitlist |
| `src/` | Components, hooks, API client, i18n |
| `assets/` | Icons and splash generated from the brand kit (`npm run gen:assets`) |

Never redraw the logo; assets come from the workspace `_brand` kit. Design rules: [Docs/DESIGN_SYSTEM.md](../../Docs/DESIGN_SYSTEM.md).

## Navigation and sign-out
* Pushed screens (appointment, care-plans, doctor, lab, pharmacy, records/*, results, review, safety, settings/*, telemedicine list, waitlist, family-share) live in `app/(tabs)/(more)/`: one hidden tab inside `(tabs)` with its own Stack, so the bottom tab bar stays and a back button is always there (Home fallback for deep links). URLs are unchanged. In expo-router 58 `href: null` tabs are not navigable, so the tab stays mounted with its button hidden. `checkout/[id]` (payment) and `telemedicine/room/[id]` stay full-screen on the root Stack on purpose.
* Sign out: Home header button and Account (button above the list and at the bottom) open `SignOutSheet` (confirm), which removes this device's push registration (`DELETE /me/devices/:id`), clears the session and the query cache and returns to `/sign-in`. Strings `signOutDlg.*` (ar/en).
* Offline UI check: `EXPO_PUBLIC_MOCK=1 npx expo start --web` then Continue with Passport (mock session). Expo Go 58 lacks `ExpoCrypto`, so device runs need a dev build.
