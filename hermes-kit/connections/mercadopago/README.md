# Mercado Pago

The payment gateway most used by Uruguayan sellers, and the one with the
best API in the country: public, documented, and with a sandbox.

## Why we DON'T use the official MCP

Mercado Pago has an official MCP (`mercadolibre/mercadopago-mcp-server`),
and it doesn't work for this. Its tools are **for development**: searching
documentation, creating applications, getting credentials, configuring
webhooks, generating test users, running the integration's quality checker.

That's for someone who's **integrating** Mercado Pago. Our client already
has it integrated — they want to know who hasn't paid them. That's why
ours, in `mcp/`, talks directly to the REST API and speaks in the business
owner's own words.

## What it exposes

Four tools that read and two that act (see `tools.json`):

| | |
|---|---|
| `payments_for_period` | How much came in between two dates, broken down by payment method |
| `search_payments` | By status, date, or reference |
| `get_payment` | The detail of one |
| `pending_payments` | What's left pending or was rejected |
| `create_payment_link` | **acts** — goes out under the business's name |
| `refund_payment` | **acts** — takes money out and can't be undone |

## Default policy

Read yes, act no. `refund_payment` also **has to go through the approval
gate** even if the client turns on "puede escribir": taking money out of
the account is irreversible, and a toggle switch isn't enough.

## The credential

A production Access Token in `MP_ACCESS_TOKEN`. It goes in the agent's
`.env`: the client **never pastes keys into the portal**. We tell them
where to find it in their dashboard and we load it ourselves — which is why
`who: assisted`.

## API limits, verified

- Search returns **up to 100 per query** and only the **last 12 months**;
  the range can't exceed 365 days. `payments_for_period` warns when the
  total might be truncated instead of lying with a round number.
- Dates go in `yyyy-MM-dd'T'HH:mm:ss.SSSZ`.

## What's missing

Testing it against a real account. It's written and goes through the
guard, but no endpoint has run against Mercado Pago yet — it needs the
token. Start with **sandbox** credentials, not production ones.

---

## What we fixed after actually reading real code (8/9)

The first version came from the documentation and had bugs. It got fixed by
reading **demoda**'s integration (`backend/src/orders/`,
`common/mercadopago/`), which has been in production for years.

**1. `X-Idempotency-Key` was missing, and it's mandatory.** Mercado Pago
made it mandatory on Payments and Refunds because they were getting
duplicated. Without the header, a retry after a timeout can **refund the
money twice** — and that can't be undone. Now the key is derived from the
payment and the amount, so retrying the same operation produces the same
request.

**2. Check the status before refunding.** demoda does this and the docs
don't suggest it: if the payment already shows `refunded`, it responds
without touching anything. Idempotency protects against an identical
retry; this protects against a manually repeated order.

**3. Webhooks were completely missing.** And with them, the rule that
makes all the difference, taken straight from demoda's handler:

> **The notification is the trigger, not the data.** It carries an id and
> nothing more trustworthy than that. The status gets requested from the
> API. Trusting the webhook's `status` is trusting something a stranger
> sent you.

Signature verification got added (HMAC-SHA256 over
`id:<data.id>;request-id:<x-request-id>;ts:<ts>;` with `MP_WEBHOOK_SECRET`),
explicit filtering by `type`/`action`, and the warning that you have to
answer 200 in under 22 seconds or MP retries every 15 minutes.

**4. Tokens are encrypted at rest.** demoda stores one per store and
decrypts it when used. We currently keep it in the agent's `.env`, which is
enough for one agent per client — but if an agent ever handles several
accounts, that's the pattern to use.

## What demoda does NOT cover: subscriptions

We looked, and **there's nothing about `preapproval` or subscriptions** in
its code. So for that we have no proven reference: we'd have to go back to
the documentation, which is exactly what failed us here. If a client needs
it, it's best treated as research work, not as "just add one more tool".

---

## Crosscheck: demoda (2023) against today's docs, and against third-party MCPs

### demoda is from September 2023

Almost three years. Its **concepts** still hold and are the ones we copied
— webhook as trigger, checking before refunding, encrypted tokens — but its
API surface needs a close look. What changed:

- **Mercado Pago is pushing the Orders API.** Checkout API now processes
  payments through Orders, and the Payments API + Merchant Orders **are
  deprecated for QR flows**, with published migration guides.
- **Nothing changes for us yet**: `/v1/payments/search` is still in the
  current reference and is the path for *reading* a business's payments.
  The deprecation targets QR, not querying.
- **Something to watch**: if a client charges via QR or Point, that's when
  we'd need to move to Orders. We'll revisit it when it comes up.

### The unofficial MCPs: both have the bug we fixed

**`hdbookie/mercado-pago-mcp`** — 27+ tools.

- **No `X-Idempotency-Key` on refunds.** The same hole: a retry refunds
  twice.
- **No webhook signature validation.** It has `simulate_webhook` but
  nothing that verifies real ones: anyone who knows the URL can tell you
  you got paid.
- **Doesn't check the status before refunding.**
- Exposes `cancel_payment`, `batch_create_payments`, `create_split_payment`,
  and `retry_failed_payment` **with no guardrails at all**. Creating batch
  payments with no protection, using someone's production key, is an
  accident waiting to happen.
- And 27 schemas is a wall for the model, on top of the context it costs.

**`dan1d/mercadopago-tool` (CobroYa)** — 5 tools, more restrained.

- Has `MERCADO_PAGO_WEBHOOK_SECRET` for HMAC validation, but **doesn't
  document the implementation**.
- Also doesn't mention idempotency on writes.
- Exposes full and partial refunds.

### Conclusion

Our 6 tools, with the guard in front of them, end up **materially safer**
than the two popular alternatives: derived idempotency, a status check
before refunding, verified and tested webhook signatures, and
`refund_payment` closed by default — the agent doesn't even see it.

And it confirms the kit's stance: it's not that third-party MCPs are bad,
it's that **nobody audits what they install**. Pulling one of these down
and plugging it in with a client's production key is exactly the scenario
the guard exists to prevent.
