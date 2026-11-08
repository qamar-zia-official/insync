# packages/integrations — ARCHITECTURE

Package: `@repo/integrations` (exists today as config only — `src/` is empty in the upload).
**Every external system lives here, behind a typed port**: Shopify, carriers, a 3PL/WMS, the
notification provider (Resend), and a distance/geo service. Provider-specific shapes never
leave this package; connectors translate them to stable internal types defined by
`application` ports.

## Layout

```
packages/integrations/
  package.json                 # exports are EXPLICIT: "./shopify/v1", "./shippo/v1", "./resend/v1", "./testing" …
  src/
    shared/                    # provider-neutral plumbing, behavior-frozen
      http-client.ts           #   fetch wrapper: timeout, retry policy, redaction, correlation id
      retry-policy.ts
      redact.ts
      hmac.ts                  #   timing-safe compare helpers
    shopify/
      v1/
        index.ts               #   public surface: factories + public types ONLY
        config.ts              #   ShopifyConnectorConfigSchema (Zod) + SHOPIFY_API_VERSION + timeouts
        order-webhook.connector.ts          # implements application OrderWebhookConnector
        order-webhook.provider-schema.ts    # Zod for the raw payload (private)
        order-webhook.translate.ts          # provider payload → ParsedOrderWebhook (pure)
        errors.ts                           # provider error → AppError
        order-webhook.connector.test.ts
        fake.ts                             # createFakeOrderWebhookConnector() for tests
        __fixtures__/                       # recorded real payloads, frozen
    shippo/v1/ …               # rates, shipment creation, tracking-webhook parsing
    three-pl/v1/ …             # FulfillmentProvider
    resend/v1/ …               # NotificationSender
    geo/v1/ …                  # DistanceProvider
    testing/                   # exports fakes: createFakeShippingRateProvider() …
```

(The earlier `mock-fulfillment-provider` seen in the Turbo test log becomes
`three-pl/v1/fake.ts`; its two behaviors — duplicate submissions return the original provider
request; a simulated outage is marked retryable — are kept as required connector tests.)

## The connector contract

Every connector folder has the same files, named the same way (CONVENTIONS §1.1):

| File | Responsibility |
| --- | --- |
| `index.ts` | Exports `create<Provider><Capability>Connector`, its config type, and nothing else |
| `config.ts` | Zod schema for config (credentials, base URL, timeouts); **constructed by the composition root from `@repo/env`; connectors never read `process.env`** |
| `*.connector.ts` | Implements one application port. Pure orchestration of: build request → call → parse → translate → return |
| `*.provider-schema.ts` | Zod for untrusted provider payloads/responses. Provider types stay private |
| `*.translate.ts` | Pure functions both directions; the only code that knows both vocabularies |
| `errors.ts` | The only place provider errors are inspected; yields `AppError` |
| `fake.ts` / `testing/` | In-memory implementation of the same port, deterministic |
| `__fixtures__/` | Recorded provider payloads; frozen like contract fixtures |

### Behavior every connector must define (documented in a `## Behavior` block in its `index.ts`
header or a sibling `README`-free comment)

| Concern | Rule |
| --- | --- |
| Auth/config | Credentials via injected config; never logged |
| Timeouts | Explicit per call (default 10 s); exceeded ⇒ `dependency_timeout` |
| Retry | Only for idempotent reads or calls carrying an idempotency key; exponential backoff + jitter; max attempts in config; never retry a non-idempotent write blindly |
| Uncertain outcome | A write that timed out after the provider may have acted ⇒ `uncertain_outcome`; the caller reconciles via a read, never re-submits |
| Validation | Every provider response parsed with the provider schema; a violation ⇒ `dependency_failed`, never a crash or a silent default |
| Error translation | 4xx permanent ⇒ non-retryable code; 429/5xx/network ⇒ retryable code |
| Logging | `provider`, `operation`, `durationMs`, correlation id, provider request id; never secrets, tokens, bodies with customer data |
| Idempotency | Outbound writes send a deterministic key derived from the business id |
| Rate limits | Respect `Retry-After`; surface `rate_limited` |

## Webhook connectors (inbound)

An inbound connector implements `OrderWebhookConnector` (or the tracking equivalent):

```ts
verify({ rawBody, headers }): { ok: true; shopDomain: string; deliveryId: string; eventId?: string; topic: string }
                            | { ok: false; reason: "missing_header" | "bad_signature" }
parse({ rawBody, headers }): ParsedOrderWebhook   // throws AppError("unsupported" | "validation_failed")
```

- `verify` computes the HMAC over the **raw** bytes with the shop's secret, compares in
  constant time, and runs **before** any JSON parsing. Re-serialized JSON must fail.
- `parse` never guesses an unimplemented topic (`unsupported`, not a best effort).
- The `ParsedOrderWebhook` type is defined in `application/v1/ports` and is provider-neutral.

## Provider API versions vs internal versions

The provider's own API version (e.g. `SHOPIFY_API_VERSION`) is a constant in `config.ts` and is
bumped as a deliberate, tested change recorded in `changes.md`. The **internal** `v1/` folder
changes only when the *internal port contract* must change incompatibly — then a sibling
`v2/` is added and `application/v2` points at it.

## Compatibility

| Component | Implements | Supports |
| --- | --- | --- |
| `<provider>/v1` | `application/v1` ports | `domain`, `shared/*` |
| `shared/*` | all connectors | behavior-frozen utilities |

## Testing

Per CONVENTIONS §10: fixture → internal type; each provider error → expected code/retryable;
timeout; schema-violating response; HMAC tests (valid, tampered body, re-serialized body,
missing header, wrong secret, timing-safe path); redaction test on captured logs. **Live
provider calls are never part of the automated suite.**

## Adding a connector or capability

1. Port exists in `application/v1/ports` (define it first, from the business need).
2. Create `src/<provider>/v1/` with the fixed file set above.
3. Add explicit `exports` entry; add fake in `testing/`.
4. Record fixtures from the sandbox; freeze them.
5. Wire in the composition roots. Replacing a provider changes only the composition wiring.
6. Update this doc's layout and `changes.md`.
