# PLAN — how the platform gets built

This plan is the build order. Each phase ends with **exit criteria that are checked, not
asserted**; the phase is recorded complete in `changes.md` only when its checks have actually
been run. Read `ARCHITECTURE.md` and `CONVENTIONS.md` first.

**Status: Phase −1 (planning documents) complete. Phase 0 is next.** No application code has
been written in this run.

## How every phase runs

1. Re-read `AGENTS.md`, the root docs, and the `INSTRUCTIONS.md` / `ARCHITECTURE.md` of each
   directory about to change (AGENTS §10 step 1).
2. Write the phase's definition (AGENTS §10 step 2): versions affected, compatibility
   guarantees, failure cases, tests.
3. Build each feature in the **fixed order** in `CONVENTIONS.md` §9.
4. Verify: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` for touched
   workspaces. Record exactly what ran.
5. Update docs, append `changes.md`, report (AGENTS §10 steps 5–6).

**Definition of done for any phase:** exit criteria met · all versions' tests green · docs
match code · `changes.md` appended · no undocumented exception to a convention.

**Business measures captured per phase.** Each phase names the operational outcome it
automates. Record the real before/after values when running against a real shop's data
(manual minutes per order, orders needing intervention, exception count, time to
ship). Do not invent figures; these feed the case study for that deployment.

---

## Phase 0 — Reconcile the repository and lay the foundation

**Outcome:** a workspace where `bun install && bun run typecheck && bun run lint && bun run test`
runs green across real packages, and the rules above are mechanically enforced.

Gate before any web code: run `bun install`, then **read `apps/web/node_modules/next/dist/docs/`**
(per `apps/web/AGENTS.md`) and fill in the "Verified Next.js rules" section of
`apps/web/ARCHITECTURE.md`. The next-agent-rules block exists because this Next.js has breaking
changes; nothing in the web docs may be assumed from memory until that section is filled.

Tasks:

- **Fix inconsistencies found in the upload** (each is a `changes.md` entry):
  - `apps/api`: rename package `hono` → `@repo/api`; delete `pnpm-workspace.yaml`; replace the
    Vercel README; add `dev`/`build`/`start`/`lint`/`typecheck`/`test` scripts; extend
    `@repo/typescript-config`; drop `tsx` (Bun runs TS).
  - `apps/web`: add `typecheck` and `test` scripts (turbo expects them); align `typescript`
    (`^5` vs root `7.0.2`), `@types/node` (`^20` vs `^26`), `eslint` (`^9` vs `10.9.1`),
    `react`/`react-dom` (`19.3.0` vs `packages/ui` `19.2.8`), `packageManager` (`bun@1.4.3` vs
    root `bun@1.4.0`); verify `@tailwindcss/turbopack` is the intended Tailwind v4 integration.
  - `packages/ui`: remove the `generate:component` script (no turbo generator exists) or add
    the generator; remove template-only components not used.
  - `packages/integrations`: replace the `"./*"` export wildcard; add `src/`.
  - Remove committed `.turbo/` logs if tracked (`.turbo` is already in `.gitignore`).
  - Rewrite `apps/web/README.md`; later (Phase 6 end) rewrite the root `README.md` to match
    the code.
- **Create package skeletons** (`package.json`, `tsconfig.json`, `eslint.config.js`, empty
  `src/index.ts`, tests wired): `domain`, `contracts`, `application`, `db`, `auth`, `env`,
  `tasks`. Names `@repo/<name>`; explicit `exports` with `./v1` subpaths where versioned.
- **Enforce the rules:** `no-restricted-imports` per `CONVENTIONS.md` §13 in
  `@repo/eslint-config`; add a root script that fails if `application` imports `contracts`.
- **Env boundary:** `packages/env` with `loadRepositoryEnvironment()` and the split schemas;
  the three-place rule (schema, `.env.example`, `turbo.json`).
- **CI-equivalent script** `bun run verify` = typecheck + lint + test + build.

Exit criteria: `bun run verify` green; dependency-direction lint fails when deliberately
violated (test the failure); every package has its doc; `bun install` accepts the workspace
globs.

---

## Phase 1 — API foundation (no business endpoints)

**Outcome:** a deployable, observable HTTP boundary every later endpoint plugs into.

- `apps/api`: `server.ts`, `app.ts`, middleware chain, error envelope, `AppError` → HTTP
  mapping, hand-written CORS that also decorates error responses, `/health`, `v1` router
  mount with `deprecation.ts` stub, Better Auth mount at `/api/auth/*`.
- `domain`: `errors`, `Logger`, `Clock`, `IdGenerator`, `ShopScope`, `Brand`, `assertNever`.
- `auth`: `createAuth`, `getSession`, `isOperator` (fails closed).
- `contracts/v1/common`: `ErrorResponseSchema`, `pageOf`, `Money`.

Exit: route test matrix for `/health` and a fixture `GET /v1/ping`; CORS-on-error test;
fail-closed operator test; no secret in logs test.

## Phase 2 — Order ingestion (Stages 1–2)

**Outcome:** every Shopify order is received once, verified, and stored with an audit trail;
manual order re-keying is eliminated at the source.

- `integrations/shopify/v1`: HMAC verifier (raw body, timing-safe), topic guard, provider
  schemas, translate → internal `ParsedOrderWebhook`; fixtures; fake.
- `db`: `orders`, `order_items`, `webhook_events`, `audit_events` (+ CHECKs, uniques per
  `ARCHITECTURE.md` §6.1); `webhook-event` + `order` repositories.
- `application/v1`: `ingestOrderEvent` with claim → apply → record-failure; ports.
- `apps/api/v1/webhooks/shopify`: route chain `rawBody → verify → topic → parse → use case`.
- Decide Q4 (payload retention) and re-verify Shopify's duplicate-detection header guidance.

Exit: concurrent-delivery test (N parallel identical deliveries ⇒ one order); failed delivery
is retried not acknowledged; bad HMAC → 401 and **nothing recorded**; cancellation frozen in
SQL; fixtures frozen as `v1`.

## Phase 3 — Domain model and schema (Stages 3–5 foundations)

**Outcome:** the vocabulary of fulfillment exists as tested pure code.

- `domain`: `identifiers`, `money`, `order`, `order-status`, `address` (shippability
  judgement), `stock` (`available` derived), `warehouse`, `fulfillment-group`,
  `allocation`, `shipment`, `shipment-status`, `exception`, `access` (roles).
- `db`: `warehouses`, `warehouse_routes`, `inventory`, `inventory_reservations`,
  `fulfillments`, `fulfillment_groups`, `fulfillment_group_items`, `exceptions` (with
  partial unique index on open `(order_id, type)` — README's duplicate-flood fix).

Exit: domain suite runs without a database; schema/domain agreement test reads CHECK
constraints from the live DB and compares to domain status lists.

## Phase 4 — Allocation, routing, and the worker (Stages 3–4)

**Outcome:** a placed order is automatically assigned to stock without overselling.

- `domain`: `evaluateAllocations` (quantity-aware; feasible candidates, not a final choice),
  `selectWarehouse` (hard country filter → whole basket → priority → id).
- `application/v1`: `evaluateAllocations`, `routeOrder`, `runRoutingPass`; ports incl.
  `FulfillmentJobDispatcher`.
- `db`: routing repository — lock order row `FOR UPDATE`, lock candidate stock in
  `(warehouse, sku)` order, decide on locked data, write reservations + group(s) atomically.
- `tasks`: cron + manual routing task; failing order does not stop the batch, but the pass
  fails loudly.

Exit: ten-way contention test allocates exactly the available units (verified to fail
without the lock); idempotent re-route; no partial reservation; loud-failure test.

## Phase 5 — Operations visibility (Stage 9 read side)

**Outcome:** operators see and close what automation could not complete, with a recorded
reason — replacing spreadsheet/Slack triage.

- `contracts/v1/exceptions`, `application/v1` list/close use cases, repository, API routes
  (operator-gated, shop-scoped, keyset-paginated, compare-and-set close, actor from session).
- `apps/web/features/v1/exceptions`: sign-in, shop picker, queue, close form.
- Add TanStack Query (Q3).

Exit: close-race test (exactly one winner); forged `actor` in body ignored; 401/403/409
visible in the UI with the request id; dashboard logic tests pass; vertical slice driven
against a running API.

## Phase 6 — Tenant membership and authorization

**Outcome:** a merchant's users see only their shop; the staff allow-list stops being a
cross-merchant read grant.

- `shop_memberships` (+ role), `domain/access`, `requireShopAccess` middleware, scope
  derived from membership instead of a request field. Backward-compatible migration;
  operator list retained for staff.
- Rewrite root `README.md` to match reality.

Exit: cross-shop read/write tests return `not_found`; role matrix tests; v1 contract
unchanged (scope source changes, wire does not — if it must, that is `v2`).

## Phase 7 — Fulfillment groups, splitting, consolidation (Stages 4–5)

**Outcome:** orders no single site can fill still ship, at known cost.

- New domain functions for multi-warehouse candidates and group consolidation; behavior
  that changes v1 outputs is introduced as **`application/v2`** + `contracts/v2`; v1 keeps
  its documented single-site behavior.
- `integrations/geo/v1` distance/zone provider (candidate input only — never the decision).

Exit: scenario tests A–D from AGENTS §2 Stage 5 as table-driven cases; v1 suite unchanged.

## Phase 8 — Policy and approval (Stages 6–7)

**Outcome:** each merchant's commercial rules decide, and exceptional cases wait for a human.

- `FulfillmentPolicy` port, `rules` implementation (max cost, max days, min margin,
  preferred sites, max shipments), customer preference input, fallback/escalation policy.
- `decisions` table, `needs_approval` persistence, `resolveApproval` use case + dashboard
  action; workflow resumes from DB state.

Exit: hard constraints enforced after any policy; approval survives a process restart;
reject/approve resume tests.

## Phase 9 — Carrier connectors and shipments (Stage 8)

**Outcome:** labels and tracking numbers are created automatically, without double-buying.

- Ports `ShippingRateProvider`, `ShipmentCreator`; first carrier connector (Shippo key
  already declared); `shipments`, `packages`, `shipment_events` tables; explicit
  group ↔ package ↔ tracking relationships.
- Uncertain-outcome handling (`uncertain_outcome` code + reconcile step).

Exit: timeout-after-accept test never creates a second label; connector fixtures frozen.

## Phase 10 — Tracking, notifications, shipment dashboard (Stage 9)

**Outcome:** customers and staff see true shipment state without anyone chasing carriers.

- Carrier webhook route (verify → dedupe → out-of-order-safe state machine), Resend
  connector behind `NotificationSender`, dashboard order/shipment views rendering persisted
  state only.

Exit: duplicate and out-of-order event tests; UI never shows a state without a persisted event.

## Phase 11 — 3PL fulfillment connector

**Outcome:** orders flow into a third-party warehouse without manual handoff, and
confirmations flow back. (The platform's strategic destination.)

- `FulfillmentProvider` port; connector (`THREE_PL_API_KEY`); submit/ack/confirm state
  mapping into `FulfillmentStatus`; reconciliation job.

Exit: submit is idempotent by key; provider outage marked retryable; ack/confirm mapped
without leaking provider shapes.

## Phase 12 — AI-assisted policy (only after the deterministic system is live)

AI ranks candidates behind the `FulfillmentPolicy` port; cannot violate hard constraints or
authorize spend; every recommendation stores inputs, ranking, and rationale for audit.

## Later — Returns (separate bounded context)

Out of scope until explicitly instructed (AGENTS Stage 10).

---

## Cross-phase backlog (do not forget)

- Retention and access control for stored raw webhook payloads (PII).
- Webhook secret rotation procedure.
- Dead-letter view for permanently failed deliveries.
- Rate limiting on public endpoints.
- Backup/restore and migration rollback notes per migration.
