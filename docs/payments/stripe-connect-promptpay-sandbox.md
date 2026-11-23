# PRODX-POS — Stripe Connect PromptPay Sandbox Plan

**Status:** BLOCKED — Stripe Connect platform eligibility and Test-mode account access are not verified.

**Tracking:** [GitHub issue #404](https://github.com/prodxowner-png/PRODX-POS/issues/404).
**Scope:** Thailand-based vertical SaaS/POS. Each merchant Tenant sells directly to its own walk-in customers and must receive its own PromptPay proceeds. PRODX-POS is the software platform, not the merchant of record for store sales.

## Decision

Evaluate Stripe Connect **SaaS platform + Direct Charges**. A payment must be created in the connected merchant account context, not on the PRODX-POS platform balance. Stripe's Connect planner identifies Direct Charges as the default SaaS pattern and recommends Stripe-owned processing pricing and connected-account responsibility for merchant risk/losses. Use the connected merchant's full Stripe Dashboard initially; avoid building a custom financial dashboard before payment eligibility is proven.

This is a provisional architecture decision, not authorization to process live payments. Stripe's PromptPay documentation says PromptPay supports Connect and full/partial refunds, but the public documentation retrieved for this review does not explicitly prove the exact combination **Thailand platform + Thailand connected account + PromptPay + Direct Charges**. Obtain written confirmation or a successful end-to-end Test-mode proof from Stripe before treating this combination as supported.

## Evidence checked (2026-11-23)

- Stripe PromptPay: THB presentment, customer scans QR, Stripe confirms payment, Connect support listed, full/partial refunds supported. Hosted-redirect refunds are asynchronous and final outcomes arrive through `refund.updated` / `refund.failed`.
- Stripe PromptPay test flow: create a QR in Test mode; scan with a QR reader; Stripe-hosted test page lets the tester authorize or fail the payment.
- Stripe Connect planner: classifies this business as a SaaS platform because merchants sell to their own customers; recommends Direct Charges, Stripe-owned pricing, connected-account risk ownership, full Stripe Dashboard, and embedded onboarding for new connected accounts.
- Stripe account read-only inspection: the only account exposed to this connector is a **live** Thailand Standard account. It reports `charges_enabled=false`, `payouts_enabled=false`, `details_submitted=false`, `promptpay_payments=inactive`, and `transfers=inactive`, with outstanding verification requirements. It is not a usable Test-mode platform context and no connected accounts were created.
- Repository inspection: no Stripe SDK/provider adapter or Stripe webhook route exists. Existing `POST /api/v1/payments/lifecycle` accepts provider/status fields from an authenticated request body; it is not a trusted provider webhook and must not be used as Stripe settlement evidence. Checkout currently writes `prodx_orders` with default `server_confirmed`, inserts payment rows, and deducts stock in the same transaction. It does not wait for an asynchronous external QR payment confirmation.
- Existing `prodx_payment_attempts` stores attempts but has no connected-account mapping, provider event inbox, Stripe environment discriminator, or Stripe refund reference. Existing `refund-service.ts` intentionally fails closed for non-cash refunds until a provider adapter exists.

## Sandbox prerequisites — no-cost / no-live-money

1. Obtain a dedicated Stripe Test-mode context/account in the connected Stripe app. Do not use the currently exposed live context for test writes.
2. Ask Stripe to confirm Connect platform activation for the Thailand platform account and the exact PromptPay Direct Charges flow for Thai connected accounts.
3. Confirm the required Connect account configuration and onboarding type. Prefer the current Accounts v2 configuration for new SaaS platforms; do not create legacy `type=standard|express|custom` accounts based only on old examples.
4. Enable PromptPay in Test mode for the platform and confirm whether each connected account must separately activate/request the relevant payment-method capability.
5. Use two test connected merchants (Tenant A and Tenant B), both in Thailand, and keep their account IDs distinct.
6. Create QR payments only in Test mode. Use Stripe's test QR page to simulate success and failure. Never use a real banking app or real funds during this phase.

## Target payment lifecycle

`POS checkout -> server-authoritative order draft -> payment attempt (pending) -> Stripe Direct Charge in connected-account context -> PromptPay QR -> verified Stripe webhook -> provider status retrieval/reconciliation -> atomic local capture/finalization -> append-only audit + inventory/sale effects`.

External HTTP calls must happen outside PostgreSQL transactions. A verified webhook is durably inserted into an idempotent inbox/outbox flow first; processing must be safe under duplicate delivery, out-of-order delivery, retries, and worker crashes. A timeout means `unknown/pending`, never `failed` or `paid` by assumption.

### Required invariants

- Resolve `tenant_id`, organization, store, and connected account from authenticated server-side membership/configuration. Never accept a Stripe account ID from the POS request body.
- Create the PaymentIntent under the resolved connected account context; persist the connected account ID with the attempt and provider reference.
- Require account capability/status to be active before accepting a payment.
- Verify Stripe webhook signatures using the raw request body and endpoint secret; bind each event to the expected connected account and payment attempt.
- Idempotency key + immutable payload fingerprint for payment creation and webhook processing; unique constraints at PostgreSQL level.
- Do not mark an order paid or deduct stock as a completed sale before verified payment success. Define reservation/expiry/release semantics before changing checkout; current checkout commits order and stock immediately.
- Keep money in integer minor units at application boundaries and PostgreSQL `NUMERIC`; no floating-point calculations.
- Refunds are asynchronous where Stripe specifies; retain provider refund IDs and only mark external settlement complete on final provider confirmation. Never retry a refund with a new key after an ambiguous timeout without first reconciling the original request.
- Preserve tenant RLS, audit append-only behavior, and financial compensation/reversal semantics.

## Required test matrix

- Tenant A payment is created only in connected account A; Tenant B only in B.
- Cross-tenant account ID substitution is rejected server-side.
- Connected account onboarding incomplete / capability inactive blocks payment creation.
- PromptPay QR success, failure, expiry, and provider timeout/unknown.
- Duplicate and out-of-order `payment_intent.*` events; invalid signature; wrong connected account; amount/currency mismatch.
- Retry after process crash between provider success and local commit.
- Concurrent duplicate checkout and duplicate webhook processing.
- Refund full/partial, asynchronous pending/succeeded/failed, duplicate refund request, and reconciliation after timeout.
- Sale finalization, inventory deduction, payment ledger, and audit atomicity; no stock deduction on failed/expired payment.
- PostgreSQL integration tests with two tenants and RLS enabled; no mocked DB gate.

## Explicit blockers before implementation can be safely wired

1. **Stripe account/platform blocker:** the connected Stripe account currently visible is live-only, incomplete, and has PromptPay inactive. Test-mode account context is not available through the connector.
2. **Provider eligibility blocker:** exact Thai Connect + PromptPay + Direct Charges eligibility is not proven by the retrieved public docs. Obtain Stripe Support confirmation or a successful sandbox test using Thai connected accounts.
3. **Checkout state-machine blocker:** current checkout finalizes orders and stock immediately; asynchronous QR settlement requires an explicit pending-payment/order state and reservation policy. This is a cross-cutting database/domain change and must be designed with migrations and concurrency tests, not patched by marking the existing payment lifecycle endpoint as trusted.
4. **Refund blocker:** issue #96 remains open; external provider refund settlement and reconciliation are not implemented.

## Safe execution boundary

No live Stripe API writes, Connected Account creation, payment creation, refund, production environment change, database migration, or production deployment was performed as part of this plan. Do not switch to live mode to test. Revisit this document after Test-mode access and Stripe eligibility confirmation are available.
