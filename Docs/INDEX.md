# Docs index (kiorex-platform)

Start with the [README](../README.md), then pick a document.

| Document | What it covers |
|---|---|
| [README.md](README.md) | Original docs hub (kept) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Bounded contexts, money ledger, booking consistency, flags |
| [DOCKER_AND_FRONTEND_BUILDS.md](DOCKER_AND_FRONTEND_BUILDS.md) | API image build and boot, front-end build recipe (OIDC authority), in-process scheduler |
| [RUNBOOK.md](RUNBOOK.md) | Local run, env, seeds, mock providers, home-visit operations |
| [API.md](API.md) | Generated route reference |
| [COMMISSION_DEFAULTS.md](COMMISSION_DEFAULTS.md) | Recommended commission defaults (COM-4): values, rationale, how to change them in Ops, seed, env keys, LG-COM-20 recommendation |
| [GROWTH.md](GROWTH.md) | Growth and acquisition engine data model, SQL functions, flags, default config (Wave 1) |
| [SEO.md](SEO.md) | Public site: hybrid SSR role, canonical/hreflang, robots, sitemaps, caching, fallbacks, CWV, build and tests (GRW-P1-E) |
| [ATTRIBUTION.md](ATTRIBUTION.md) | Growth attribution core: pure decision function, decisions, versioned config, touch and events, evidence (GRW-P1-B) |
| [WIDGET.md](WIDGET.md) | Embeddable booking widget and JS SDK: embed host, per-organisation frame-ancestors, session token, postMessage protocol, SRI, limits, tests (GRW-P1-G) |
| [CONSENT.md](CONSENT.md) | Consent records, preference centre, suppression, marketing gate and caps, banner (GRW-P1-I) |
| [PROVIDERS.md](PROVIDERS.md) | SMS / Email / WhatsApp / Payment provider contract: env, neutral payloads, webhooks, mock simulators, go-live |
| [NEEDS_HUMAN.md](NEEDS_HUMAN.md) | Open decisions and STOP flags |
| [VERTICALS.md](VERTICALS.md) | Pharmacy, Lab, telemedicine and records design notes |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Brand tokens and UI rules |
| [CONTRACTS_DISTRIBUTION.md](CONTRACTS_DISTRIBUTION.md) | Vendored `@kiorex/contracts` tarball |
| [UPGRADE_NOTES.md](UPGRADE_NOTES.md) | Nov 2026 dependency and toolchain upgrade: versions, migration changes, pins and why |
| [TEST_DATA.md](TEST_DATA.md) | Synthetic QA data (DEV ONLY) |
| [kiorex-cursor-build-sequence.md](kiorex-cursor-build-sequence.md) | Build sequence and progress tracker |

Per-folder READMEs: [apps/api](../apps/api/README.md) · [apps/web](../apps/web/README.md) · [apps/ops](../apps/ops/README.md) · [apps/mobile](../apps/mobile/README.md) · [infra](../infra/README.md) · [infra/tofu](../infra/tofu/README.md).

Images used by the README live in [assets/](assets/).
