# Outbound providers: SMS, Email, WhatsApp, Payment

Going live with a real vendor is **only** setting environment values (secrets from Secrets Manager / SSM). Everything else (HTTP client, timeouts, retries, idempotency, webhook signature, status persistence, startup validation) is built and tested against a local fake vendor. Passport (`kiorex-account`) and the sibling repos use the same variable names.

## 1. Inventory (what sends / charges today)

| Flow | Code | Kind used |
|---|---|---|
| Booking confirmation / reminders / review invite / waitlist offer / refund notices | `engagement/engagement.service.ts` -> `MessagingHub` (`messaging/`) | WHATSAPP, SMS, EMAIL (+ PUSH, mock only) |
| Waitlist offers | `waitlist/waitlist.service.ts` -> `EngagementService.notify` (`WAITLIST_OFFER`) | same |
| Home-visit family share (invite, updates) | `homecare/family-share.service.ts` -> `MessagingHub` | WHATSAPP / SMS |
| Safety-alert on-call paging | `homecare/safety-delivery.adapter.ts` | SMS (real mode) |
| WhatsApp conversational booking (inbound + replies) | `channels/` | WHATSAPP |
| Deposits, order payments, refunds, pay links | `pay/pay.service.ts`, `pay/psp.ts` | PAYMENT |
| Passport OTP and notifications | `kiorex-account` `packages/otp-sender`, `apps/dev-idp` | WHATSAPP, SMS |
| PUSH (FCM / APNs) | `MessagingAdapter` PUSH | not covered: no HTTP provider; stays mock |

## 2. Environment contract

| Variable | Meaning |
|---|---|
| `<KIND>_MODE` | `mock` (default) or `real`. KIND = `SMS`, `EMAIL`, `WHATSAPP`, `PAYMENT` |
| `<KIND>_API_URL` | vendor / gateway base URL (https; http only for loopback in tests) |
| `<KIND>_API_KEY` | vendor credential, sent as `Authorization: Bearer <key>` (mapping may change) |
| `<KIND>_SENDER_ID` | SMS sender id, EMAIL from address, WHATSAPP phone-number id (not used by PAYMENT) |
| `<KIND>_WEBHOOK_SECRET` | HMAC secret for the status / payment webhooks (>= 16 chars) |
| `<KIND>_TIMEOUT_MS` | optional, default 8000 |
| `<KIND>_MAX_RETRIES` | optional, default 2 (up to 3 attempts) |
| `WHATSAPP_TEMPLATE_MAP` | optional JSON `{ "<kiorex template id>": "<approved template name>" }` |
| `SAFETY_DELIVERY_MODE=real` + `SAFETY_ONCALL_PHONES` | on-call paging via the real SMS provider |

Legacy aliases still work when `<KIND>_MODE` is unset: `MESSAGING_MODE=real` (SMS/EMAIL/WHATSAPP), `PSP_MODE` (`sandbox-fake` = mock, anything else = real).

**Fail-fast:** `main.ts` calls `verifyProviderStartup()` before listening. `MODE=real` with a missing/invalid URL, key, sender id or webhook secret aborts startup with a message that lists variable **names only**. Mock in `NODE_ENV=production` starts but logs a warning.

## 3. Behaviour of the real adapters

* One HTTP call with `AbortController` timeout; retries on network error, timeout, 429 (honours `Retry-After`) and 5xx with exponential backoff and jitter; 4xx is never retried.
* `Idempotency-Key` header on every attempt: message id for messages, `checkout:<paymentId>` and `refund:<refundId>` for payments. Retries cannot double-send, double-charge or double-refund.
* Error mapping (no vendor body, URL, key or recipient ever stored or logged): `PROVIDER_TIMEOUT`, `PROVIDER_NETWORK`, `PROVIDER_RATE_LIMITED_429`, `PROVIDER_UNAUTHORIZED_401`, `PROVIDER_INVALID_REQUEST_400`, `PROVIDER_PROVIDER_UNAVAILABLE_5xx`, `PROVIDER_REJECTED_<status>`, `PROVIDER_BAD_RESPONSE`. Stored on `MessageLog.error` / `Message.reason`.
* Real mode stores **no body and no raw recipient** in `MessageLog` (masked recipient only); dev routes return 404.
* Statuses persist: `MessageLog.status` (`QUEUED -> SENT -> DELIVERED -> READ`, or `FAILED`; forward only), `PaymentIntent.status`, `Refund.status`, `WebhookReceipt` (event de-dupe).

## 4. The one file to adapt per vendor

`src/common/providers/<kind>.mapping.ts` (`sms`, `email`, `whatsapp`, `payment`) translates the neutral payloads below to the vendor wire format and back, and may override auth headers and webhook verification. No other file changes.

### Neutral payloads (defaults)

**SMS** `POST {SMS_API_URL}/messages` `{ "to":"+20...", "from":"<SENDER_ID>", "body":"...", "reference":"<id>" }` -> `{ "id":"<providerRef>" }`
**EMAIL** `POST {EMAIL_API_URL}/messages` `{ "to","from","subject","text","reference","template","locale" }` -> `{ "id" }`
**WHATSAPP** `POST {WHATSAPP_API_URL}/messages` `{ "to","from","type":"template","template":{"name","language":"ar|en","variables":{"body"}},"reference" }` -> `{ "id" }`
**PAYMENT** `POST {PAYMENT_API_URL}/checkouts` `{ "reference":"<paymentId>","amountMinor":15000,"currency":"EGP" }` -> `{ "id":"<pspRef>","checkoutUrl":"https://..." }`;
`POST {PAYMENT_API_URL}/refunds` `{ "paymentRef","reference":"<refundId>","amountMinor" }` -> `{ "id":"<pspRefundRef>" }`. Amounts are integer minor units.

### Webhooks (vendor -> Kiorex)

| Endpoint | Body | Secret |
|---|---|---|
| `POST /api/v1/messaging/webhooks/{sms\|email\|whatsapp}` | `{ "events":[{ "id":"<providerRef>","status":"sent\|delivered\|read\|failed","error":"...","occurredAt":"ISO" }] }` | `<KIND>_WEBHOOK_SECRET` |
| `POST /api/v1/pay/webhooks/{paymob\|fawry\|instapay}` | `{ "id":"<eventId>","type":"payment.captured\|payment.failed\|refund.settled","paymentRef","reference":"<paymentId>","amountMinor","feeMinor","occurredAt" }` | `PAYMENT_WEBHOOK_SECRET` |
| `POST /api/v1/channels/whatsapp/booking-intents` (inbound patient message) | normalised `{ from, text, buttonPayload }`, `X-Kiorex-Signature: sha256=HMAC(raw)` | `WHATSAPP_WEBHOOK_SECRET` |

Signature (generic, replaceable in the mapping): `X-Webhook-Timestamp: <unix s>` and `X-Webhook-Signature: sha256=<hex HMAC-SHA256(secret, "<ts>.<rawBody>")>`; rejected outside +-300 s or on mismatch. Duplicates are harmless: payment events are de-duplicated on event id and ledger postings are idempotent; message statuses only move forward.

## 5. Mock mode (default) and dev simulators

All dev routes are 404 when `NODE_ENV=production`, and when the kind is real.

* `GET /api/v1/dev/messaging/outbox`, `POST /dev/messaging/inbound`, `POST /dev/messaging/delivery-tick`, `DELETE /dev/messaging/outbox` (existing dev inbox).
* `POST /api/v1/dev/messaging/samples {phone?,email?,locale?}`: one booking confirmation, 24 h reminder, waitlist offer and deposit-refund message on WhatsApp, SMS and email.
* `POST /api/v1/dev/messaging/webhook-simulate {id,state}`: sends a **signed** delivery webhook through the real webhook handler for a mock message.
* `GET /api/v1/dev/payments`, `POST /api/v1/dev/payments/:id/simulate {outcome: captured|failed|refund_settled}`: sends a signed PSP webhook through `PayService.handlePspWebhook`. The sandbox hosted checkout `/pay/fake-checkout/:id` (Pay / Fail buttons) keeps working.
* Ops console: Messaging log page (`/admin/messaging/*`) simulates delivery states.

## 6. Tests

`src/common/providers/providers.unit.spec.ts` (fake HTTP server: retry, backoff, idempotency, timeout, error mapping, HMAC, fail-fast) and `test/providers.int.spec.ts` (real-mode messaging and payment wiring through the API against a fake vendor, signed webhooks, replay, dev routes disabled).

## 7. Notification layer (`@kiorex/contracts/notify`, contracts 1.7.0)

Every engagement message (booking, reminder, review invite, home-visit, pharmacy and lab notices) is now sent through the shared `NotificationService` instead of calling the hub directly. The layer decides consent, opt-out, quiet hours, address, PHI safety and the per-channel body; the hub below it is unchanged and still owns the `MessageLog` row, the mock/real choice per kind (`<KIND>_MODE`) and the vendor mapping files in `common/providers/`.

```
EngagementService.deliver()  ->  NotificationService.dispatch(intent: one channel)
                                   |-- PlatformPreferenceStore (consent, NotificationPreference, QUIET_HOURS_*)
                                   |-- TemplateRegistry (the 25 NotifyKind templates, ar/en, PHI-free allowed params)
                                   `-- HubChannelAdapter (SMS/EMAIL/WHATSAPP/PUSH) -> MessagingHub.send -> mock | HttpMessagingAdapter
                                       InboxChannelAdapter (INAPP)                  -> the engagement Message row IS the inbox
```

* **Files:** `messaging/notification.bridge.ts` (adapters), `engagement/notification.layer.ts` (registry, preference store, result mapping), `engagement/engagement.service.ts` (`deliver`, `inbox`).
* **Same behaviour:** mock and log mode send exactly what they did (`...0000` still bounces, dev inbox rows identical, statuses `SENT | FAILED | SKIPPED_CONSENT | SKIPPED_OPTOUT | DEFERRED` unchanged). Consent order is consent, opt-out, quiet hours, address.
* **New safety:** an undeclared template param is dropped before dispatch (callers historically passed extras); a PHI pattern (national id, MRN, lab value, diagnosis word, prescription) in an SMS, push or WhatsApp body fails that message as `PHI_BLOCKED:<code>`; email and in-app are not scanned. Nothing PHI is logged: the audit line is `<type> <channel> <status> <reason>`.
* **Inbox:** the in-app inbox already existed (`Message` rows with channel `INAPP`, `GET /inbox`, read receipts), so no table or migration was added. It is a first-class layer channel and `inbox()` renders through the registry.
* **Webhooks:** `MessagingHub.handleStatusWebhook` keeps its URLs, signature check and idempotence, and now normalizes vendor words with `normalizeVendorStatus` and applies them with `mergeStatus` (forward-only). `HubChannelAdapter.parseWebhook` / `verify` expose the same mapping to the layer.
* **Not yet used here:** multi-channel routing and receipt-timeout fallback (`tick()`): the engagement queue keeps one `Message` row per channel, so each dispatch is single-channel. Turning on severity routes needs a persistent `DispatchStore` (a table) and is a later step, see `kiorex-contracts/docs/NOTIFICATION_LAYER.md`.
* **Adding a notification:** add the copy to `engagement/templates.ts` (`NotifyKind`); it is registered automatically with its placeholders as the only allowed params.
* **Tests:** `engagement/notification.layer.unit.spec.ts`; the existing `messaging`, `engagement`, `providers`, `whatsapp-booking` integration suites exercise it end to end.

Full design: [kiorex-contracts/docs/NOTIFICATION_LAYER.md](../../kiorex-contracts/docs/NOTIFICATION_LAYER.md).

Go-live steps and the exact secrets: **Provider go-live checklist** in [../DEMO_DATA.md](../DEMO_DATA.md).
