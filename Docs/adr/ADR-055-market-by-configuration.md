# ADR-055: Market by configuration: MARKET_PROFILE and data-cell binding

**Status: Proposed, unsigned (draft of 25 Nov 2026, wave 9 lane A4).** Package GRW-P3-G and GRW-GC-4b (built locally, W8 lane A2). Founder signature needed: nothing here binds anything until it is signed. Counsel or finance needed: Counsel per country (licence, consent regime, health-advertising rules); the CTO and counsel for data residency.

**Context.** KX-28 section 13 promised that a new country is a configuration exercise. In practice the code carried about 70 literals for EG, SA and AE (currency, time zone, quiet hours, phone region). A second market would have needed code edits in many modules, and a half-configured market could have appeared to patients.

**Decision.**
1. **`MARKET_PROFILE` is a versioned configuration kind** (one MARKET-scope version per country through the existing maker-checker, ADR-047) holding names, currency and minor units, phone code and region, IANA time zone, languages, canonical URL segment, quiet hours, working week, geography, specialties, consent defaults, provider-import references, a data-cell binding and regulation switches as booleans and ids. It holds no legal text, price, fee or tax rule.
2. **A resolver, with a fallback.** `market-registry.ts` reads the configuration first and falls back to the code map for EG, SA and AE (behaviour unchanged). A compile-time-parsed unit test (`no-market-literals`) fails on any `EG|SA|AE` literal or Cairo, Riyadh or Dubai zone outside two allow-listed files, so the registry cannot silently regress.
3. **An onboarding wizard that never launches.** Eight validated steps, a geography CSV import (all or nothing), a readiness list that separates to-do from needs-a-person (counsel texts, licence, launch gate). Publishing drafts configuration versions for a second approver and registers the live flag `market.<cc>.live` launch-locked OFF; only a person records the gate (ADR-024). A new market stays hidden from bootstrap and sign-up until then.
4. **Data-cell binding.** A market names the data cell it uses. With one deployed cell (Frankfurt) every new market maps to it and the wizard says so; a second cell and cross-cell routing do not exist and need a decision by counsel and the CTO before a market with a residency requirement.

**Consequences.** A new market needs configuration, counsel work and a person recording the gate, not a code release; the synthetic market `ZY` (JOD, three decimals, Asia/Amman) proves the path in tests. Several consumers still answer for EG (reward currency strings, assistant money formatting, default quiet window of marketing, preference-centre default market) and the SSR markup of a live new market is not proven: a market is not ready for patients until they are done (launch guide, market rows). **Implementation:** built locally (unit 13 + 6, integration 9, e2e 38 8 of 8, Playwright 34); migration `20270128091000_growth_p3_market_onboarding`; nothing is deployed and no real second market is chosen.

**Open (NEEDS_HUMAN).** Which real second market, its regulation and consent regime, data residency and cell are founder and counsel decisions (H-14).

Source of record: `_docs/growth/GROWTH_ARCHITECTURE_DECISIONS.md` section 27 in the workspace repository (this file is the repository copy; keep them equal).
