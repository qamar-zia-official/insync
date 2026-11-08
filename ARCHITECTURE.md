# ARCHITECTURE — Order Fulfillment Automation Platform

> Authority order when documents disagree: **`AGENTS.md` > this file and the per-directory
> `ARCHITECTURE.md` / `INSTRUCTIONS.md` files > `README.md`**. The README is descriptive and
> partly historical (see §1). Everything here is a *plan until the matching phase in
> [`PLAN.md`](./PLAN.md) is marked complete*.

Document map:

| File | Answers |
| --- | --- |
| `AGENTS.md` | The non-negotiable rules and the lifecycle |
| `ARCHITECTURE.md` (this) | What the system is made of, who may depend on whom, what is versioned |
| [`CONVENTIONS.md`](./CONVENTIONS.md) | The one way to write every kind of function, schema, connector, form, action, test |
| [`PLAN.md`](./PLAN.md) | The order the system gets built in, with exit criteria |
| [`changes.md`](./changes.md) | Append-only history of every modification |
| `apps/api/ARCHITECTURE.md`, `apps/web/ARCHITECTURE.md` | The deployable apps |
| `packages/*/ARCHITECTURE.md` or `INSTRUCTIONS.md` | One per package |

---

## 1. Reality check: what the repository contains today

The uploaded copy is a **skeleton**, not the system the README describes. Verified from the
files and from `bun.lock` (which lists exactly six workspaces):

| Claimed by `README.md` | Actually present |
| --- | --- |
| `packages/domain`, `application`, `db`, `validation`, `auth`, `tasks`, `email` | **Absent.** None are in `bun.lock`. |
| `apps/api/src/server.ts`, Hono routes, CORS, error envelope | `apps/api` is the Vercel "Hello Hono" starter (`src/index.ts`, package name `hono`, a stray `pnpm-workspace.yaml`, npm/Vercel README). |
| `apps/web` operations console | `apps/web` is the unmodified `create-next-app` page. |
| `packages/integrations` with a mock fulfillment provider | Only config files; `.turbo/turbo-test.log` shows `src/mock-fulfillment-provider.test.ts` once existed, but `src/` is gone. |
| 325 tests, Phases 1–6 complete | No source, so none are runnable. |

What *is* real and reusable: the Turborepo/Bun workspace, `turbo.json` (with the strict-env
declarations and `db:*` tasks filtered to `@repo/db`), the shared `typescript-config` and
`eslint-config` packages, `packages/ui`, `.env.example`, and the README's **design reasoning**
(idempotency in the database, lock-before-decide, fixed error messages, hand-written CORS,
operator allow-list limits). Those decisions are kept below and credited to the README.

**Consequence.** This plan treats the codebase as greenfield-on-a-good-foundation and builds it
to `AGENTS.md`. Where the README's design conflicts with `AGENTS.md` (mainly: no versioning, a
single `allocated_warehouse_id`, no `packages/contracts`), `AGENTS.md` wins. If the full
source exists elsewhere, stop and reconcile against it instead (Open Question Q1).

---

## 2. Principles (from AGENTS.md §1, made operational)

1. **A webhook accepted is not a fulfillment completed.** Acceptance, workflow state, and
   shipment state are three separate persisted states.
2. **Boundaries validate; interiors trust.** Zod at HTTP, webhook, provider response, task
   payload, form, and env. Nowhere else.
3. **Provider details never cross a connector.** Provider payloads become internal types at the
   edge.
4. **A version is a folder.** A new contract/behavior is a new `vN/` sibling; `v1` is frozen.
5. **The database enforces what code cannot.** Uniqueness, CHECKs, row locks, transactions.
6. **UI shows persisted state only.** No optimistic "shipped".
7. **Every decision is explainable.** Policy outcomes record candidates, rule, and actor.

---

## 3. Package map and dependency rules

```
                    ┌──────────────┐
                    │  apps/web    │  Next.js dashboard (versioned features)
                    └──────┬───────┘
                           │ HTTP only (no server imports)
                    ┌──────▼───────┐
                    │  apps/api    │  Hono: transport + composition root v1
                    └──────┬───────┘
         ┌─────────────────┼──────────────────────────────┐
         ▼                 ▼                              ▼
 packages/contracts   packages/application ◄──── packages/db            (adapters
 (Zod, versioned)     (use cases + ports,         (Drizzle repos)         implement
         │             versioned)                                          ports)
         │                 ▲   ▲                  packages/integrations
         │                 │   └───────────────── (Shopify, carriers, 3PL, notifications, geo)
         │                 │
         └────────►  packages/domain  ◄──────────  packages/tasks (Trigger.dev, thin)
                     (pure, zero deps)

 Cross-cutting, no business logic:  packages/env · packages/auth · packages/ui
 Tooling:                           packages/typescript-config · packages/eslint-config
```

### Allowed imports (✔ allowed, ✘ forbidden; read row → column)

| Importer ↓ / Imports → | domain | contracts | application | db | integrations | auth | env | tasks | ui |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **domain** | — | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| **contracts** | ✔ (constants/types only) | — | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| **application** | ✔ | ✘ | — | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| **db** | ✔ | ✘ | ✔ (port types) | — | ✘ | ✘ | ✘ | ✘ | ✘ |
| **integrations** | ✔ | ✘ | ✔ (port types) | ✘ | — | ✘ | ✘ | ✘ | ✘ |
| **auth** | ✔ | ✘ | ✘ | ✔ (adapter) | ✘ | — | ✘ | ✘ | ✘ |
| **tasks** | ✔ | ✔ (payload only if shared) | ✔ | ✔ | ✔ | ✘ | ✔ | — | ✘ |
| **apps/api** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (dispatcher) | ✘ |
| **apps/web** | ✔ (pure rules/constants) | ✔ | ✘ | ✘ | ✘ | ✔ (`/client` only) | ✔ (public) | ✘ | ✔ |

Two rules carry most of the weight, and both are enforced by lint (Phase 0):

- **`application` never imports `contracts`.** The API maps wire shapes to use-case inputs.
  That one mapper per endpoint is the price of letting the HTTP contract and the business
  function evolve independently (AGENTS §4.2–4.3).
- **Only the composition roots (`apps/api/src/composition`, `packages/tasks/src/composition.ts`)
  know that `db` and `integrations` exist.** Everything else sees ports.

Imports between packages use the package name and a declared subpath, never a relative path
and never a deep path (`@repo/application/v1`, not `@repo/application/src/v1/use-cases/...`).

---

## 4. What is versioned, and what is not

| Thing | Versioned? | Mechanism | Rule |
| --- | --- | --- | --- |
| HTTP routes and handlers | **Yes** | `apps/api/src/v1/` | `/v1/...` URL prefix; v1 frozen after release |
| Public Zod contracts | **Yes** | `packages/contracts/src/v1/` | New shape ⇒ new `v2/` file, never edit v1 |
| Use cases and ports | **Yes** | `packages/application/src/v1/` | Each API version owns entry points even if identical |
| DB repository adapters | **Yes** (they implement versioned ports) | `packages/db/src/repositories/v1/` | May share low-level query helpers |
| Connectors | **Yes** | `packages/integrations/src/<provider>/v1/` | New internal contract ⇒ sibling `v2/` |
| Background task payloads | **Yes** | `packages/tasks/src/payloads/v1/` | In-flight jobs must keep parsing |
| Dashboard features | **Yes** | `apps/web/features/v1/` | Each version names the API version it consumes |
| Domain model | **No** (additive only) | — | Behavior change ⇒ new named function; old one stays until retired |
| DB schema and migrations | **No** (own compatibility track) | expand → migrate → contract | Never added because an API version was added |
| Env schema | No | — | Additive |
| UI primitives | No | — | Shared when it creates no behavioral coupling |
| `/health`, `/api/auth/*` | No (documented exceptions) | — | Operational and third-party-defined |

**Cross-version import rule:** `v2` may import `domain`, shared low-level utilities, and
primitives. `v2` must **never** import from `v1`, and `v1` never from `v2`. Copying a small
function into `v2` is correct; sharing it is only correct when it is a generic utility whose
behavior cannot be changed by either version's needs.

**Compatibility is proven, not inferred.** Each version has frozen fixtures
(`__fixtures__/v1/*.json`) that must keep parsing and keep producing the same outputs. See
[`CONVENTIONS.md` §10](./CONVENTIONS.md#10-testing).

---

## 5. Lifecycle → modules

Each AGENTS.md stage mapped to the module that owns it. If a behavior has no row here, it has
no owner yet — add one before writing code.

| Stage | Responsibility | Domain | Use case (`application/v1`) | Adapter | Entry point |
| --- | --- | --- | --- | --- | --- |
| 1 Webhook reception | Verify, validate, identify store/event | `scope`, `order` intake rules | `ingestOrderEvent` | `integrations/shopify/v1` (verify, parse) | `POST /v1/webhooks/shopify/orders` |
| 2 Authn / authz / idempotency | Four separate concerns | `access` roles | (claim inside `ingestOrderEvent`) | `db` `webhook-event` repo; `auth` | API middleware chain |
| 3 Background workflow | Durable, retryable handoff | `workflow-state` | `runRoutingPass`, `advanceFulfillment` | `tasks` | Trigger.dev tasks + dispatcher port |
| 4 Inventory & allocation | Feasible candidates by quantity | `stock`, `allocation` | `evaluateAllocations` | `db` inventory repo | task |
| 5 Consolidation & routes | Groups, warehouse choice, shipment plan | `fulfillment-group`, `shipment-plan` | `planFulfillment` | `integrations/geo/v1` | task |
| 6 Policy & viability | Rules → AI → human approval | `policy`, `decision` | `decideFulfillmentPlan`, `resolveApproval` | `db` decision repo; (later) AI port | task + dashboard action |
| 7 Customer preferences | Cost vs speed, fallbacks | `shipping-preference` | folded into `decideFulfillmentPlan` input | — | — |
| 8 Shipment & carrier | Rates, labels, uncertain outcomes | `shipment`, `package` | `createShipments` | `integrations/<carrier>/v1` | task |
| 9 Tracking & dashboard | Verify, dedupe, order events; read model | `shipment-status` | `ingestTrackingEvent`, read use cases | carrier webhook connector; `db` read repos | `POST /v1/webhooks/<carrier>`, `GET /v1/...` |
| 10 Returns | **Out of scope** | — | — | — | Separate bounded context later (§9) |

The four decisions AGENTS §4 Stage 5 requires to stay distinct are **four functions with four
typed results**: *allocation* (what stock can cover), *consolidation* (how groups combine),
*warehouse selection* (which candidate), *shipment planning → carrier/service selection* (how
it travels). No function does two of them.

---

## 6. Cross-cutting designs

### 6.1 Idempotency (AGENTS Stage 2)

Scope and key are decided here once; do not re-decide per endpoint.

- **Delivery level.** `webhook_events` has a unique constraint on
  `(provider, shop_domain, external_delivery_id)`. For Shopify the delivery id is
  `X-Shopify-Webhook-Id`; `X-Shopify-Event-Id` is stored for correlation (a merchant action
  can fan out to several webhooks). *Shopify's own pages disagree on which header to
  deduplicate with — one says Event-Id, the current one says Webhook-Id. Re-verify against the
  live docs in Phase 2 and record the finding in `changes.md`.*
- **Business level.** `orders` is unique on `(shop_domain, external_order_id)`, so a different
  delivery describing the same order cannot create a second order.
- **Transaction boundaries.** *Claim* commits in its own transaction **before** work, so a crash
  leaves `processing` as evidence. *Apply* (order + items + audit + terminal status) is one
  transaction. *Failure record* commits separately. (README Phase 2 reasoning, retained.)
- **Claim outcomes** are a union, not a boolean: `claimed | already_processed | retry`.
  A `failed` delivery is retried, never acknowledged as a duplicate.
- **Concurrent deliveries** are resolved by the unique constraint with `ON CONFLICT`, not by a
  pre-read.
- **Downstream** (tasks, shipments, carrier calls) carry their own deterministic idempotency
  keys derived from business ids, e.g. `shipment:{fulfillmentGroupId}:{attempt-independent}`.

### 6.2 Tenancy

Every persisted business row carries `shop_domain` (to become `shop_id` when the membership
table lands). Every repository method takes a `ShopScope` as its **first parameter**; there is
no method that reads or writes by id alone. Ids are random and unguessable, but scoping is the
control — unguessability is only defense in depth. Until per-shop membership exists the
operator allow-list is a *staff* grant to every merchant, and the UI says so (README
"The operator gate, and what it is not"). Membership is Phase 6, before any external user.

### 6.3 Workflow state

Three independent persisted state machines, each a discriminated union in `domain`:
`OrderStatus` (what the commerce platform says), `FulfillmentStatus` (what *we* have decided and
done), `ShipmentStatus` (what carriers say). The dashboard renders each separately; it never
derives "delivered" from anything but `ShipmentStatus` backed by a persisted carrier event.

### 6.4 Policy (AGENTS Stage 6)

`FulfillmentPolicy` is a port. Implementations: `rules` (default), `human-approval` wrapper,
`ai-ranked` (Phase 12). Hard constraints are enforced **after** any policy returns, by domain
code, so no policy implementation can violate them. A policy returns
`approved | rejected | needs_approval` with the candidate set and reasons; `needs_approval`
persists a `decisions` row and the workflow ends its run (state in DB, not in memory) and is
resumed by a separate use case when an authorized user decides.

### 6.5 Security checklist (applies to every endpoint)

1. Verify sender (HMAC / signature) — webhooks only, over the **raw** body, constant-time.
2. Authenticate principal — session or integration key.
3. Authorize — role + `ShopScope`.
4. Validate — schema from `contracts/vN`.
5. Execute — use case.
6. Respond with a fixed message per error code; details only in logs keyed by `requestId`.
7. Never log secrets, tokens, webhook secrets, or unnecessary customer data.

---

## 7. Decisions

| ID | Decision | Why | Changes README? |
| --- | --- | --- | --- |
| D-01 | Authority: AGENTS.md > architecture docs > README | AGENTS.md states it governs | — |
| D-02 | `packages/contracts` (versioned Zod) + `packages/env` replace README's `packages/validation` | AGENTS §4.3 names `contracts`; env is not a public contract | Yes |
| D-03 | Provider payload schemas live in `integrations`, not `contracts` | AGENTS §4.7: provider formats stay behind the connector | Yes |
| D-04 | Use case = `createX(deps)` returning `x(input)`; expected outcomes are `kind`-tagged unions; faults throw `AppError` | One shape everywhere; keeps README's "judgements return, malformed throws" | Formalizes |
| D-05 | Dashboard "actions" are typed client mutation functions, **not** Next.js Server Actions | Session cookie is `HttpOnly` + `SameSite=Lax` on the API origin; README explains why server-side forwarding breaks across subdomains | Formalizes |
| D-06 | Connectors always live under `<provider>/v1/` | Uniform; satisfies AGENTS §4.7 from day one | New |
| D-07 | Notification (Resend) is an integration, not `packages/email` | AGENTS §8 lists notification providers as integrations; one fewer package | Yes |
| D-08 | Fulfillment output is `FulfillmentGroup[]` from the first version (one group is a valid answer) | Lets split allocation arrive additively instead of reshaping v1 | Yes (README had one `allocated_warehouse_id`) |
| D-09 | Dashboard data fetching: TanStack Query; forms: React 19 `useActionState` + contract schemas | Smallest set that gives caching + typed forms | New (confirm before adding dependency) |
| D-10 | Trigger.dev is the workflow runtime; DB is the source of truth for workflow state | AGENTS §2 Stage 3: durable, not in-memory | — |
| D-11 | Request wire format: `{ data }`, `{ data, page }`, `{ error }` envelope | One serialization pattern per version | Formalizes |
| D-12 | Frozen JSON fixtures are the compatibility proof for every version | AGENTS §4.8: compile ≠ compatible | New |

## 8. Open questions (defaults apply unless you say otherwise)

| ID | Question | Default used in these docs |
| --- | --- | --- |
| Q1 | Does the full source (domain/application/db/…) exist elsewhere? | No — plan rebuilds it to AGENTS.md. If yes, send it; Phase 0 becomes reconciliation. |
| Q2 | API host: Bun server (README) or Vercel function (starter)? | Bun server, `server.ts` entry; `app.ts` stays host-agnostic so either works. |
| Q3 | Confirm TanStack Query (D-09) as a dependency? | Yes, added in Phase 5. |
| Q4 | Retention for stored raw webhook payloads (customer PII)? | 30 days then null the payload column; decide before Phase 2 ships. |
| Q5 | `.env` in the upload contains real-looking values (DB URL, secrets). | Treat as exposed if the zip was shared; rotate before any deployment. Never commit it. |

## 9. Returns (future, AGENTS Stage 10)

Not built. Designed-for by keeping `fulfillment` and `shipment` free of return concepts (no
`direction` flag, no return statuses) and by reserving the folder names
`packages/application/src/v1/returns/` and `apps/web/features/v1/returns/`. A returns
subsystem imports fulfillment *read* ports; fulfillment never imports returns.
