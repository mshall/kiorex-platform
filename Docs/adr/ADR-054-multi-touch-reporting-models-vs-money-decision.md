# ADR-054: Multi-touch reporting models versus the deterministic money decision

**Status: Proposed, unsigned (draft of 25 Nov 2026, wave 9 lane A4).** Package GRW-P3-B (built locally, W7 lane A2). Founder signature needed: nothing here binds anything until it is signed. Counsel or finance needed: None beyond ADR-042; the money decision itself is unchanged.

**Context.** Marketing wants to see credit shared across touches (linear, time decay, position based, data driven). The commission decision of ADR-042 must stay a single deterministic, reproducible, provider-verifiable function; a model that re-distributes credit must never decide whether Kiorex charges a fee.

**Decision.**
1. **Two separate things.** The *decision* (`decide.ts`, ADR-042) produces `PROVIDER_LED`, `MARKETPLACE` or `UNATTRIBUTED` and drives commission. The *reporting models* (`attribution-models/`) only produce shares of credit for analysis and write their own tables (`GrowthAttributionModelResult`, `GrowthPathSnapshot`). They never read or write a decision, a charge or a policy; a test asserts the decision rows are byte-identical after a run.
2. **Seven models, one set of facts.** `LAST_TOUCH`, `LAST_NON_DIRECT`, `FIRST_TOUCH`, `LINEAR`, `TIME_DECAY` (7 day half-life), `POSITION_BASED` (40 first, 40 last, 20 shared; the default report) and `DATA_DRIVEN` (a first-order Markov chain with removal effect, computed only at 1,000 or more attended new patients in 90 days). Credit is exact integer arithmetic (a conversion is 1,000,000 parts, revenue split by largest remainder), so every model reconciles to the same conversions and revenue to the minor unit; a conversion with no touch goes to `UNATTRIBUTED`.
3. **Identity limits.** Touches join one person only through `sub` and a `visitorKey` already recorded together; no fingerprint, no probabilistic matching, no third-party graph; withdrawal of analytics consent removes earlier touches. Windows are counted in market days.
4. **Privacy.** Aggregates only; path snapshots only for paths shared by 10 or more conversions (a table CHECK); cells under 10 are masked with secondary suppression.
5. **Lift is separate again.** An experiment-based lift view (holdout against exposed units of a P3-A experiment) uses its own two-proportion test and reports arms of 10 or more units only.

**Consequences.** Finance and marketing get comparable channel views without risk to the fee promise; two views of the same booking can legitimately differ (the decision says who brought the patient for fee purposes, a model says how credit may be shared for budgeting), and the page must say so. **Implementation:** built locally (unit 29, integration 10; 500k-touch fixture rolls up in about 8 s); settings are code defaults until contracts 1.13.0 publishes the `ATTRIBUTION_MODELS` config kind and a flag; nothing is deployed.

**Open (NEEDS_HUMAN).** Default report choice, half-life and the data-driven gate are marketing and analytics confirmations (launch guide, attribution models row).

Source of record: `_docs/growth/GROWTH_ARCHITECTURE_DECISIONS.md` section 26 in the workspace repository (this file is the repository copy; keep them equal).
