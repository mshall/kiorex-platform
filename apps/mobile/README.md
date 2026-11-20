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
