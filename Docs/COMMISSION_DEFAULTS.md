# Recommended commission defaults (COM-4, 27 Nov 2026)

**These are recommended starting points. They are not legal advice and not pricing advice.** The founder instruction of 27 Nov 2026: the numbers, the counsel sign-off and the disclosure wording stay configurable from Ops (super admin) and can be changed in production at any time, but the platform now ships recommended default values instead of "no number shipped". The Egypt (EG) market, EGP minor units (100 piastres = 1 EGP).

## What ships

| Item | Installed as | State |
|---|---|---|
| Default rate for `CLINIC`, `PHARMACY`, `LAB` | `CommissionRatePolicy` scope `DEFAULT`, version 1, status `ACTIVE`, `provenance = SEEDED_DEFAULT`, `seedVersion = 1` | in force from the moment the seed runs |
| Collection settings of market `EG` (cycle and cut-off, which the rate does not carry) | `CommissionPolicy` scope `MARKET`, version 1, `ACTIVE`, `provenance = SEEDED_DEFAULT` | in force |
| Disclosure wording AR and EN, override reason hidden | `GrowthConfigVersion` kind `COMMISSION_DISCLOSURE`, market `EG`, version 1, status **`DRAFT`**, `ticket = SEEDED_DEFAULT`, text starts with "Draft pending counsel review." (AR: the same) | **never in force**, nothing reaches an organisation until a super admin proposes a version and a different one approves |
| Counsel sign-off | **nothing is installed** | `COMMISSION_COUNSEL_SIGNOFF` stays `NOT_REVIEWED`; every real-money collection mode and payout route stays blocked (`COUNSEL_BLOCKED`); mock mode runs |

## Values and rationale

Common to the three types (all editable per type, and per organisation as an override): collection mode `NET_FROM_PAYOUT`, currency `EGP`, rounding `HALF_UP`.

| Value | Clinic | Pharmacy | Lab | Why |
|---|---|---|---|---|
| Fee type | PERCENT | PERCENT | PERCENT | A percent follows the size of the visit or order, so a small visit pays little. A flat amount per charge stays available in Ops. |
| Rate (`percentBps`) | **300 (3.00 %)** | **200 (2.00 %)** | **300 (3.00 %)** | Deliberately low: the aim is adoption in the first months and a number nobody has to defend. Pharmacy goods carry thin margins, so the lowest rate. Basis: the marketplace-attributed service amount (Clinic), the goods total (Pharmacy), the tests total (Lab). |
| Minimum per charge (`minMinor`) | **1000 (EGP 10)** | **500 (EGP 5)** | **1000 (EGP 10)** | A floor so a very small charge still covers the cost of handling it. Lower for Pharmacy, where baskets are smaller. |
| Cap per charge (`maxMinor`) | **7500 (EGP 75)** | **10000 (EGP 100)** | **10000 (EGP 100)** | A cap so a large invoice is never charged a large commission; keeps the worst case predictable for the provider. |
| Minimum to collect in a period (`minCollectMinor`) | 5000 (EGP 50) | same | same | Below this the period's claims roll to the next period (never lost), so no payout is touched for a trivial amount. |
| Grace days (`graceDays`) | 3 | same | same | Days after the cut-off before collection starts, so late disputes and reversals settle first. |
| Dunning retry days (`retryDays`) | [3, 7, 14] | same | same | Three retries at 3, 7 and 14 days after the first failed attempt, then the run falls back to an invoice. Inside the platform bounds (6 retries, day 60). |
| Invoice due days (`invoiceDueDays`) | 14 | same | same | Only used when a collection falls back to an invoice. Two weeks. |
| Reminder days (`reminderDays`) | [-3, 0, 7, 14] | same | same | Relative to the invoice due date: 3 days before, on the day, 7 and 14 days after. |
| Dispute window (`disputeWindowDays`) | 14 | same | same | Days after confirmation in which the organisation may dispute a charge. |
| Saved-method (token) charge (`savedMethodChargeAllowed`) | false | false | false | Not permitted by default: the real saved-method charge is not built (LG-COM-4) and it is a real-money mode that counsel must approve first. |
| Market collection settings, EG | cycle `MONTHLY`, cut-off day 1 (00:00 UTC), mode `NET_FROM_PAYOUT`, grace 3, retries [3, 7, 14], minimum 5000, invoice due 14 | | | The rate carries the mode, grace, retries, minimum and invoice days; the market row adds the two things it cannot carry (cycle and cut-off). Monthly on the 1st keeps one settlement per month for the provider. |

Worked example (Clinic): a 1 000.00 EGP visit gives 30.00 EGP; a 100.00 EGP visit gives the floor, 10.00 EGP; a 5 000.00 EGP visit gives the cap, 75.00 EGP.

Disclosure draft (AR and EN, neutral and plain): says that Kiorex charges a commission on bookings and orders that came through the marketplace; that the rate, any own rate and the start dates are shown on the page; that a change applies only from its start and never changes a recorded commission; that the commission is normally deducted from the bank payout, cash visits are still counted and netted at settlement, small amounts carry over or are invoiced; and where the statement is. It names **no figure** (so it cannot go stale when a rate changes), makes **no legal claim** and says **nothing about tax**. The reason of an override is **hidden from the organisation** by default (`showOverrideReason = false`; recommended, configurable).

## How the seed works

- Code: `apps/api/src/commissions/commission-defaults.ts` (values, validators, installer). It runs from the base seed (`prisma/seed.ts`, which production runs through the seed image, never on boot) and on its own with `npm run db:seed:commission-defaults`.
- **Idempotent and safe to re-run.** A scope that already has any row (operator, pending, rejected, or a seeded row) is left alone. It never supersedes, edits or overwrites a row an operator entered. A pending operator proposal also counts as an operator row.
- **Versioned.** `DEFAULTS_VERSION` (1) is stored in `seedVersion`. If a later release raises it, a new row is appended **only** where the newest row of that scope is still an untouched seeded row of an older version; once an operator has entered a row, the seed never touches that scope again.
- **Provenance.** Rates and market settings carry `provenance = SEEDED_DEFAULT` (column added by the additive migration `20270305090000_com4_commission_defaults`; operator rows keep `null`). The disclosure draft carries `ticket = SEEDED_DEFAULT`. The Ops rate views show `provenance` on the effective rate and in the history; every install writes an audit row `commission.defaults_installed` by actor `system:seeded-default`. The provider-facing view never carries it.
- The database keeps the rate history append-only; the guard now also refuses to change the provenance of a pending row.

## How to change them (all production-safe, no deploy)

1. Ops > Commissions > Rates: a super admin proposes a new default for the type (or an override for one organisation, with a mandatory reason), an **effective date** (never in the past), and a **different super admin** approves. The new version applies from its start and never rewrites a recorded charge. The seeded row stays in the history as version 1, **append-only** (the database refuses edits and deletes).
2. Ops > Commissions > Collection settings (maker-checker) for cycle, cut-off and the other collection settings of the market.
3. Ops > Commission policy > Disclosure texts: a super admin proposes a version (it becomes version 2; the seeded draft stays in the history and never goes live), a different one approves. Counsel supplies or approves the final wording.
4. Counsel sign-off is **only** recorded by a human in Ops > Commission policy after counsel's review. The seed never writes it and nothing marks it APPROVED on anyone's behalf.

## Env and config keys

| Key | Default | Effect |
|---|---|---|
| `COMMISSION_DEFAULTS_SEED` | on | `false` (also `0`, `off`, `no`) makes the seed skip the install; the platform then behaves as before (no rate set = no charge). Nothing already installed is removed. |
| Ops rate rows (maker-checker) | the seeded rows | The operative override: any approved row with a later start wins. |
| `PHARMACY_TAKE_RATE_BPS`, `LAB_TAKE_RATE_BPS` | 0 | Legacy fallback, used only for an order that has **no** rate snapshot. With the defaults installed every new order snapshots the effective rate, which replaces them (LG-COM-13). |
| `COMMISSION_RETRY_DAY_MAX`, `COMMISSION_RETRY_MAX_COUNT`, `COMMISSION_GRACE_DAYS_MAX`, `COMMISSION_INVOICE_DUE_DAYS_MAX` | 60, 6, 30, 90 | Bounds of what a rate or settings form accepts (the seeded values sit inside them). |
| `COMMISSION_AGING_BUCKET_DAYS`, `COMMISSION_JOB_INTERVAL_MS`, `MONEY_POLICY_NOTICE_DAYS` | 30,60,90; 15 min; 7 | Unchanged. |

## Mock versus real money

In mock mode (the default) a charge accrues at the seeded rate, the monthly run starts without any further operator entry and nets from payouts in the mock rails. In real mode the run is `COUNSEL_BLOCKED` while the sign-off is `NOT_REVIEWED`; this is proved by `apps/api/test/commission-defaults.int.spec.ts`.

## Direct bank / InstaPay transfer and card terminal at the clinic (LG-COM-20): DECIDED by the founder 27 Nov 2026, implemented locally

**Decision (27 Nov 2026):** these payments count as a cash-type tender for accrual and netting AND are recorded as their own kind, `CASH_TRANSFER` ("cash transfer"). Implementation: the wire `tender` stays `CASH` | `ONLINE` (contracts 1.13.0 unchanged); two additive optional claim fields carry the kind, `tenderMethod` (`CASH` | `CASH_TRANSFER`) and `tenderDetail` (`BANK_TRANSFER` | `INSTAPAY` | `CARD_TERMINAL`). An older client sends neither, so its `CASH` reads as plain cash. A visit whose payment method is unknown stays not reported (never guessed) and is counted as an exception in the settlement statement (`unknownTender`) and the Ops summary. The statement keeps the cash-type totals and adds `cashBreakdown` (plain cash and cash transfer separately, with the detail counts); the CSV, the Ops view and the claims export show the kind. The earlier recommendation text follows for the record.

Today the Clinic reports the tender of a visit as `CASH` or `ONLINE`; a direct bank or InstaPay transfer to the clinic and a card-terminal payment are reported as "not known". Recommendation: **count both as `CASH` tender for accrual and netting.** Reasoning: from Kiorex's side they behave exactly like cash (the patient paid the clinic directly, Kiorex never saw the money and cannot take the commission out of that payment), so the only way to collect is the same as for cash, netting in the next bank-transfer settlement or an invoice when no payout is due. Leaving them "not known" would let a clinic avoid commission on any non-cash visit it does not label, and it would make the statement less transparent for both sides. Suggested rules if the founder agrees: (1) the Clinic maps `BANK_TRANSFER`, `INSTAPAY` and `CARD_TERMINAL` to `CASH` in the claim event (no contract change needed, the value set stays `CASH` | `ONLINE`), and keeps the payment method as free detail for the statement; (2) a commission accrues only for a visit the clinic marks as attended and paid; (3) tender "not known" stays possible but is shown to both sides as an exception count in the statement and in reconciliation, so it cannot hide commission; (4) the dispute window applies as for any claim. This remains a founder and finance decision (LG-COM-20) and has no legal clearance.
