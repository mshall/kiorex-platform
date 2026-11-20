# Kiorex design system (patient web + ops console)

> **Q11 (20 Nov 2026): brand kit.** Tokens, Tailwind preset, logo components and icon assets are generated from `kiorex-v2/_brand/tokens.json` and **vendored** into
> `apps/web/src/brand` and `apps/ops/src/brand` (see `_brand/README.md`: tokens.css + shadcn-bridge.css + tailwind-preset.cjs + `components/{shared,web}`). `src/styles/index.css` only
> imports them; never hand-edit colours. The logo is the founder artwork (two facing chevrons + coral ECG pulse; lockup = mark | coral rule | KIOREX in outlined Jost Medium). Do not redraw it:
> use `<KiorexLogo variant tone product>` (`@/brand/components/web/KiorexLogo`) or `@/components/Logo`. Shared layout primitives live in `src/components/kit.tsx`
> (`PageHeader`, `StatCard`, `StatusChip`, `FormField`, `Stepper`, `StateArt`) next to `states.tsx` (`EmptyState` / `ErrorState` carry the chevron+pulse illustration).
> Motion: 150-250 ms eased (`--kx-dur-*`, `--kx-ease-*`), `kx-page` route enter, skeleton shimmer, pulse draw-in; all collapse under `prefers-reduced-motion`.
> Dark theme is designed (`#0C0D1F` ground, `#161835` surface, lifted indigo/ocean/coral), not inverted. Axe gate: `e2e/ui-review/axe.spec.ts` (AR+EN x light+dark; set `AXE_CORE_PATH`).

> **Q11 P2 (20 Nov 2026): signature screens (apps/web).** New primitives: `HeroSearch` (query + specialty + area + when), `HeroArt`, `DoctorAvatar` (verified seal), `SlotPicker` (next-available shortcut, week strip, morning/afternoon/evening chips, explicit Cairo timezone line), `ReviewSummary` (average + distribution bars computed from the loaded reviews only), `HoldRing` (countdown ring), `ConfirmedMoment` (ring/check/pulse draw-in, calendar, directions, what-to-bring), `AppointmentTicket`/`DateBlock`, ghost "still to come" steps in `StatusTimeline`. Utilities in `styles/index.css`: `kx-hero`, `kx-glass`, `kx-field`, `kx-slot`, `kx-rise`, `kx-draw`, `kx-pop` (all reduced-motion safe). Doctor profile = editorial header + sticky booking panel on desktop, bottom-bar + bottom-sheet slot picker below 1024 px (`useMediaQuery`). Map/list toggle on results: the map is an honest placeholder (interactive map is still P2). Dark mode is driven by the `.dark` class (boot script in `index.html`: stored `kx-theme`, else OS preference; the header toggle flips it), so `data-theme="auto"` is not needed in apps/web.

> **Q11 P3 (20 Nov 2026): service flows.** `kit.tsx` adds `StatusBanner`, `SegmentedControl`, `Row`, `IconTile`, `Timeline`; `OrderBits` has the order/lab tracker and pay panel; `SpecialtyIcon` / `SpecialtyTile` is the per-specialty icon set (24 px grid, 1.75 stroke, indigo + ocean + one coral accent; unknown codes fall back to a neutral icon). Phones use a bottom bar + bottom sheet for the pharmacy cart and lab summary (`useMediaQuery`), `useOnline` drives the offline banner/state, `useInView` gates the how-it-works pulse draw-in. DEV fixtures for e2e states: `apps/web/e2e/fixtures.ts`.

Owner: frontend/UX. Applies to `apps/web` (patient, Arabic-first) and `apps/ops` (ops console, English default). Source of truth in code:
`apps/web/src/styles/index.css` (tokens), `apps/web/tailwind.config.ts`, `apps/web/src/components/ui/*` (shadcn), `apps/web/src/components/{Logo,PulseLine}.tsx`.
`apps/ops` carries identical copies of the tokens and UI primitives (no shared package yet — keep them in sync).

Direction: **calm clinical trust**. Arabic-first and RTL-perfect, generous whitespace, one strong primary, coral used only as a quiet pulse.

## 1. Colour (HSL tokens, light / dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` Indigo | `#3730A3` | `#8B85F0` | primary buttons, active nav, headings accents, wordmark |
| `--secondary` / `--ocean` Ocean | `#0369A1` | `#38BDF8` | links, secondary actions, info, final X of the wordmark |
| `--pulse` Coral | `#E8735E` | same | **accent only**: ECG motif, active chip border/tint, rating stars, focus ring, map pin. Never for errors or body text |
| `--background` Ground | `#F4F6FC` | `#0C0D1F` | page |
| `--card` | `#FFFFFF` | `#161835` | cards, header, sheets |
| `--foreground` | `#1E1B4B` | `#E8EAFB` | text |
| `--muted-foreground` | `#475569` | `#A5ACC8` | secondary text |
| `--border` / `--input` | `#E2E8F0`-ish / 3:1 form border | | hairlines / form control borders |
| `--destructive` | `#B91C1C` | `#F87171` | errors, destructive actions, emergency (never coral) |
| `--success` / `--warning` / `--info` (+ `-soft`) | emerald-700 / amber-800 / ocean | lifted | status badges and notes |

Rules: body text uses `foreground` (>= 9:1 on Ground). Indigo on white is 9.6:1, Ocean on white 5.9:1 (both AA for body text). Coral on white is 3.0:1, therefore it is never the only carrier of text or meaning; text placed on coral uses `--pulse-foreground` (indigo-950, 5.1:1). The focus ring is coral (3:1 non-text contrast) and 3 px thick.
Dark mode: `.dark` on `<html>`, set from `localStorage["kx-theme"]` or `prefers-color-scheme` before first paint (inline script in `index.html`).

## 2. Typography

* Latin: **Jost** (geometric sans). Arabic: **IBM Plex Sans Arabic**. Loaded from Google Fonts; `html[lang="ar"]` puts Plex Arabic first and uses line-height 1.7.
* Wordmark `KIOREX` is always Latin, letter-spaced (0.28em), final **X in Ocean**, even in the Arabic UI.
* Scale: h1 30-48 px (landing hero), page title 24 px, section 20 px, card title 18 px, body 16 px, small 14 px, caption 12 px. Weight 600 for headings, tight tracking only for Latin.
* Numbers use `kx-label-num` (tabular) where they align (prices, countdown, tables). Times are rendered `dir="ltr"` inside Arabic text so `09:40` never reorders. Intl formatting is Arabic-Indic digits in AR (`ar-EG`), `en-GB` in EN, timezone `Africa/Cairo`.

## 3. Shape, spacing, elevation

* Radius **14 px** (`--radius`; `rounded-xl`), pills for chips/badges, `rounded-2xl` hero blocks.
* Cards: white, 1 px border, `shadow-card` (very soft). Page gutter 16 px; sections separated by 24-32 px.
* Touch targets >= **44 px** everywhere (buttons `min-h-11`, chips, inputs `h-11`, checkboxes sit in 44 px labels, nav rows 56 px on mobile).

## 4. Logo and the pulse motif

* `LogoMark`: indigo ">" and ocean "<" chevrons facing each other with the coral ECG pulse crossing the gap (founder artwork, `_brand/kiorex-mark.svg`); `Logo` = lockup (mark | coral rule | KIOREX), swapped to the inverse tone under `.dark`. App icon / favicon: indigo-to-ocean gradient tile, white chevrons, coral pulse.
* The pulse line is a **sparing** brand device: `PulseDivider` (section breaks, footer), `PulseLoader` (the line draws itself while loading), the hero watermark, and the ECG in the logo. It is not used as wallpaper or on every card.
* Reduced motion: all animation is disabled under `prefers-reduced-motion`.

## 5. Components (shadcn, restyled by tokens)

Harvested from `kiorex-web-app` `components/ui` (button, card, input, label, badge, dialog, sheet, checkbox, select, skeleton, tabs, switch, textarea, separator, alert, radio-group, tooltip, sonner, progress, avatar, popover, dropdown-menu, table) and converted to **logical properties** (`ms-/me-/ps-/pe-/start-/end-`, `border-s/e`, `text-start/end`) so they mirror in RTL. Sheets slide from the *end* edge; the switch thumb flips; direction-implying icons use `.rtl-flip`.

Product components: `DoctorCard`, `SlotButton`, `FiltersSheet`, `SearchBar` + `SpecialtyChips`, `FamilySwitcher`, `StatusTimeline`, `ClinicMap` (placeholder), `EmergencyBanner`, `Rating`, `VerifiedBadge`, `SlotTakenDialog`; states: `LoadingState` (pulse loader), `CardSkeleton`, `EmptyState`, `ErrorState` (red, retry), `UnavailableState` (flag OFF). Ops: `OpsLayout`, dense `DataTable`, `StatTile`.

Button variants: `default` (indigo), `secondary` (ocean), `outline`, `ghost`, `destructive`, `link`, `pulse` (coral fill with indigo-950 text, used once per screen at most, e.g. the post-visit review CTA and the landing sign-in). Badge variants: `success|warning|info|pulse|destructive|secondary`.

## 6. States and tone

* Every data view has **loading** (skeleton or pulse loader), **empty** (explains and offers the next action), **error** (retry) states.
* **Flag OFF** (KX-08 §08): a 403 `FEATURE_DISABLED {key, scope}` or `flags/effective.enabled=false` shows "Temporarily unavailable / غير متاح مؤقتًا"; data is never hidden and existing appointments remain viewable.
* Errors are red, never coral. Emergency guidance is a red-bordered alert with a `tel:123` button and no booking path.
* Voice (KX-14): plain, confident, proof-based ("only verified doctors; reviews only from completed visits; the fee upfront"). **No fictional testimonials or invented statistics.** Arabic copy is written natively, not translated word for word. Sign-in is branded "Kiorex Passport".

## 7. Accessibility

WCAG 2.1 AA: contrast as above; visible 3 px coral focus ring on every focusable element; skip link; landmarks (`header/nav/main/footer`, labelled `nav`s); `aria-live` for results count and slot selection; roles for radio groups, tabs, timers and timelines (`aria-current="step"`); `lang`/`dir` on `<html>` and `lang` on language labels; form fields have visible labels; no information by colour alone (status badges carry text/icons).

## 8. RTL rules

1. Arabic is the default language; `<html dir>` follows the language. 2. Use logical Tailwind utilities only (never `left/right/ml/mr`). 3. Latin tokens inside Arabic text (times, phone numbers, IDs, the wordmark) are isolated with `dir="ltr"`. 4. Flip directional icons (chevrons, arrows, sign-out) with `.rtl-flip`; do not flip clocks, check marks or logos. 5. Verify with Playwright (`apps/web/e2e/rtl.spec.ts`): `dir=rtl`, no horizontal overflow at desktop and Pixel 7, screenshots in `apps/web/e2e/screenshots/`.

## 9. Ops console deltas

English by default (Arabic available and RTL-correct), 240 px sidebar on desktop and a scrolling tab bar on phones, dense tables (sticky header, small type, horizontal scroll under 640 px), status as coloured badges with text, destructive confirmations as dialogs with reason + ticket.

## 10. Open items needing a human

Consent checkbox wording, cancellation/refund copy, emergency guidance wording and the medical content tone are **draft copy pending legal/CMO approval** (KX-16, CLAUDE.md "stop and ask"). Interactive map (KXMDS05) is P2; the clinic map is a placeholder with a directions link.
