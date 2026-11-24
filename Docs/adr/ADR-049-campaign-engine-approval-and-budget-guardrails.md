# ADR-049: Campaign engine, approval and budget guardrails

- Status: **PROPOSED** (not signed). Package GRW-P2-A.

## Context
Marketing campaigns need budgets, approval and attribution, but Kiorex must not spend on ad platforms from code in this phase, and a runaway budget is a money risk.

## Decision
- A campaign is a governed record with a state machine (`CAMPAIGN_TRANSITIONS`), a monthly ceiling, a daily cap and a budget; spending is **recorded** (manual or adapter-written `GrowthSpend` through the existing maker-checker path), never executed: **no direct ad-platform spend** is implemented.
- Approval: a campaign above the ceiling or with `growth.campaign_approval_required` needs a second super admin (author cannot approve; a second token of the same user is refused).
- Budget guardrails: budget threshold events, automatic pause on exhaustion (`CAMPAIGN_BUDGET_EXHAUSTED`), increases only through a new approval.
- Attribution: a campaign touch is marketplace evidence (7 day click window); it never makes a booking PROVIDER_LED and never changes a commission.
- Ad safety: `assertAdSafe` (no health targeting, no patient lists, no remarketing) is a safety control, never a flag.

## Consequences
Reports read tables (no consumer for campaign events yet); creative upload and landing editor are later (GC-5); the daily cap uses a market time zone table until MARKET_PROFILE (P3-G).
