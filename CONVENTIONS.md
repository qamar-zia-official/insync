# CONVENTIONS — one way to write everything

This file is the **single source for code patterns** across the monorepo. The per-app and
per-package documents add layout and examples but must not contradict it. If a pattern here
stops being right, change it here, migrate the code, and record it in `changes.md` — never fork
a second pattern inside one version (AGENTS.md §5).

Running examples used across all documents (so names stay identical everywhere):

- **Read slice:** *list exceptions* — `GET /v1/exceptions`
- **Write slice:** *close an exception* — `POST /v1/exceptions/:id/close`
- **Webhook slice:** *ingest a Shopify order* — `POST /v1/webhooks/shopify/orders`
- **Connector slice:** *Shopify order webhook connector*

---

## 1. Naming

### 1.1 Files — `kebab-case`, with a role suffix

| Suffix | Role | Lives in |
| --- | --- | --- |
| `.schema.ts` | Zod schema + inferred type | `contracts`, `integrations` (provider), `tasks` (payloads), `env` |
| `.use-case.ts` | One use case factory | `application/src/vN/use-cases/` |
| `.port.ts` | One port interface | `application/src/vN/ports/` |
| `.repository.ts` | Drizzle implementation of a repository port | `db/src/repositories/vN/` |
| `.connector.ts` | Provider implementation of a port | `integrations/src/<provider>/vN/` |
| `.translate.ts` | Pure provider ⇄ internal mapping | same folder as its connector |
| `.routes.ts` | Hono router for one resource | `apps/api/src/vN/routes/<resource>/` |
| `.mapper.ts` | Pure wire ⇄ use-case mapping | same folder as its routes |
| `.task.ts` | One Trigger.dev task | `tasks/src/tasks/` |
| `.client.ts` | Typed API client for one resource | `apps/web/features/vN/<feature>/api/` |
| `.action.ts` | Typed client mutation | `apps/web/features/vN/<feature>/actions/` |
| `.form.tsx` | Form component | `apps/web/features/vN/<feature>/forms/` |
| `.errors.ts` | Error translation or error types | any |
| `.test.ts` / `.test.tsx` | Test, colocated with its subject | any |

Domain files have **no suffix** (`money.ts`, `order-status.ts`) — they are concepts, not roles.
No `utils.ts`, `helpers.ts`, `common.ts`, or `misc.ts`: name the file for what it does.

`index.ts` exists only at a package root and at each `vN/` root. No barrels inside feature or
resource folders.

### 1.2 Identifiers

| Kind | Rule | Example |
| --- | --- | --- |
| Function | `camelCase`, verb first | `selectWarehouse`, `claimDelivery` |
| Factory | `create` + Thing | `createCloseException`, `createExceptionRepository`, `createShopifyOrderWebhookConnector` |
| Mapper | `to` + Target | `toCloseExceptionInput`, `toExceptionResponse` |
| Predicate | `is`/`has`/`can` | `isOperator`, `canCancel` |
| Type / interface | `PascalCase`, no `I` prefix, no `Type` suffix | `ExceptionRepository` |
| Zod schema | `<Name>Schema`; type is `<Name>` | `CloseExceptionRequestSchema` → `CloseExceptionRequest` |
| Const tuple of literals | `SCREAMING_SNAKE`, plural | `EXCEPTION_STATUSES` |
| Branded id | `<Entity>Id` + factory `to<Entity>Id` | `OrderId`, `toOrderId` |
| Use case I/O | `<Name>Input`, `<Name>Output` or `<Name>Outcome`, `<Name>Deps` | `CloseExceptionOutcome` |
| Outcome discriminant | field `kind`, snake_case literals | `{ kind: "already_closed" }` |
| Test | `describe("<subject>")`, `it("<behavior as a sentence>")` | `it("refuses a close without a note")` |

**Versions are folders, not name suffixes.** `v1/close-exception.use-case.ts` exports
`createCloseException`; `v2/close-exception.use-case.ts` exports the same name. Consumers
choose by import path (`@repo/application/v1`). Never write `closeExceptionV2`.

**No default exports**, except where Next.js requires them (`page.tsx`, `layout.tsx`,
`route.ts` conventions, config files).

### 1.3 Package and import names

`@repo/<name>`; versioned subpaths `@repo/contracts/v1`, `@repo/application/v1`. A package's
`exports` map lists subpaths explicitly — no `"./*"` wildcard (the current
`packages/integrations/package.json` wildcard is replaced in Phase 0).

---

## 2. Function shapes (the only allowed ones)

### 2.1 Pure domain function

No I/O, no clock, no randomness, no logging. Deterministic.

```ts
// packages/domain/src/warehouse-selection.ts
export interface SelectWarehouseInput {
  readonly destinationCountry: CountryCode;
  readonly basket: readonly BasketLine[];
  readonly candidates: readonly WarehouseCandidate[];
}

export type SelectWarehouseResult =
  | { readonly kind: "selected"; readonly warehouseId: WarehouseId }
  | { readonly kind: "unroutable"; readonly reason: UnroutableReason };

export function selectWarehouse(input: SelectWarehouseInput): SelectWarehouseResult { /* … */ }
```

### 2.2 Use case (application)

```ts
// packages/application/src/v1/use-cases/close-exception.use-case.ts
export interface CloseExceptionDeps {
  readonly exceptions: ExceptionRepository;   // ports only
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface CloseExceptionInput {
  readonly scope: ShopScope;
  readonly exceptionId: ExceptionId;
  readonly resolution: "resolved" | "dismissed";
  readonly note: string;
  readonly actor: Actor;                      // from the session, never from the body
}

export type CloseExceptionOutcome =
  | { readonly kind: "closed"; readonly exception: ExceptionRecord }
  | { readonly kind: "not_found" }
  | { readonly kind: "already_closed" };

export type CloseException = (input: CloseExceptionInput) => Promise<CloseExceptionOutcome>;

export function createCloseException(deps: CloseExceptionDeps): CloseException {
  return async function closeException(input) {
    assertScope(input.scope);                           // blank shop ⇒ throws ValidationFailedError
    const closed = await deps.exceptions.close(input.scope, { /* … */ });
    deps.logger.info("exception.closed", { exceptionId: input.exceptionId, actor: input.actor.id });
    return closed ? { kind: "closed", exception: closed } : await classifyMiss(deps, input);
  };
}
```

Rules: one use case per file; exactly one exported factory and its types; deps are ports;
no `Date.now()`/`crypto.randomUUID()` (use `Clock`/`IdGenerator` ports); no HTTP, no SQL, no
SDK imports; returns an **outcome union** for anything a user could legitimately cause, and
**throws** `AppError` for faults.

### 2.3 Repository (db)

```ts
// packages/db/src/repositories/v1/exception.repository.ts
export function createExceptionRepository(db: Database): ExceptionRepository {
  return {
    async close(scope, input) { /* one conditional UPDATE … RETURNING */ },
    async list(scope, query) { /* keyset page */ },
  };
}
```

`scope: ShopScope` is always the first parameter. One public method = one atomic unit of work
(its own transaction when it needs one). A repository never calls another repository, a
connector, or a use case.

### 2.4 Connector (integrations)

```ts
// packages/integrations/src/shopify/v1/order-webhook.connector.ts
export function createShopifyOrderWebhookConnector(
  config: ShopifyConnectorConfig,              // already validated; no process.env here
  deps: { readonly logger: Logger } = { logger: noopLogger },
): OrderWebhookConnector {                     // port defined in application/v1/ports
  return {
    verify(input) { /* HMAC over raw body, timing-safe */ },
    parse(input) { /* provider schema → translate → internal type */ },
  };
}
```

See `packages/integrations/ARCHITECTURE.md` for the full folder pattern.

### 2.5 Mapper

Pure, total, no I/O, no defaults that hide missing data.

```ts
export function toCloseExceptionInput(
  body: CloseExceptionRequest,               // contracts/v1
  ctx: { scope: ShopScope; exceptionId: string; actor: Actor },
): CloseExceptionInput { /* … */ }

export function toExceptionResponse(record: ExceptionRecord): ExceptionResponse { /* … */ }
```

### 2.6 Route handler (api) — three steps, nothing else

`validated input → map → call use case → map outcome → respond`. No loops, no business
branches except the outcome → status mapping. See `apps/api/ARCHITECTURE.md`.

### 2.7 Task (tasks) — thin

`parse payload → build deps → call use case → translate outcome to return/throw`. See
`packages/tasks/INSTRUCTIONS.md`.

### 2.8 Parameter rules (all of the above)

- More than one parameter ⇒ one `input` object. Positional parameters only for
  `scope` (first) or a single obvious value.
- `readonly` on input object fields and array types.
- Public functions have explicit parameter and return types. Local variables use inference.
- No boolean flag parameters that change behavior; split the function or use a union.
- No optional parameters that change business meaning when omitted; defaults live in schemas.

---

## 3. Types and unions

- **Discriminated unions** (`kind` field) for every stateful or multi-outcome thing.
- **Exhaustiveness**: `switch` on `kind` ends with `default: return assertNever(x)`
  (from `@repo/domain`). Maps over a status are `Record<Status, …>` so adding a state is a
  compile error in every consumer (dashboard badges, SQL CHECK test, mappers).
- **Branded ids** for every entity id (`Brand<string, "OrderId">`) with validating factories.
- **State machines are transition tables**, not `if` chains:
  `const ALLOWED: Record<Status, readonly Status[]>` plus `canTransition(from, to)`.
- **No `any`.** `unknown` + a schema parse at the boundary. A type assertion (`as`) requires a
  one-line `// why:` comment and is a review flag. `as const` and `satisfies` are fine.
- **Infer from Zod** (`z.infer`) for wire/provider/env types. Domain types are hand-written
  and never inferred from a schema (the domain has no Zod).
- **Provider types never leave `integrations`.**

---

## 4. Errors

Two channels, never mixed:

| Channel | For | Shape |
| --- | --- | --- |
| **Outcome** | Anything a real user or real data can legitimately produce: not found, already closed, not routable, duplicate | `kind`-tagged union in the use case's return type |
| **Fault** | Malformed input past a boundary, dependency failures, invariant violations, bugs | `throw new AppError(...)` |

`AppError` lives in `@repo/domain` (`errors/app-error.ts`). Construct it as
`new AppError("not_found", { context?, cause? })`; the client-safe message is derived from the
code, never from input. Fields: `code`, `retryable`, `message` (safe),
`context` (loggable, never returned to clients), `cause`.

| `code` | HTTP | `retryable` | Use |
| --- | --- | --- | --- |
| `validation_failed` | 400 (422 for webhooks/semantics) | false | Input malformed or violates a rule |
| `unauthenticated` | 401 | false | No/invalid credentials or signature |
| `forbidden` | 403 | false | Authenticated, not permitted |
| `not_found` | 404 | false | Missing **or** outside scope (never distinguish) |
| `conflict` | 409 | false | Lost a compare-and-set race, state forbids it |
| `unsupported` | 422 | false | Topic/feature not implemented — never guess |
| `rate_limited` | 429 | true | |
| `dependency_failed` | 502 | true | Provider/DB error |
| `dependency_timeout` | 504 | true | |
| `uncertain_outcome` | 502 | true* | Provider may have acted (e.g. label purchase timed out). *Retry only through the reconcile path, never blind.* |
| `internal` | 500 | true | Unexpected |

HTTP status is **derived** from `retryable`/`code` in one function
(`apps/api/src/lib/http-status.ts`); no handler picks a status for an error. The client-visible
message is a **fixed string per code**; the thrown message goes to logs only.

Connectors translate provider errors into `AppError` in their `errors.ts`; nothing else
inspects a provider error.

---

## 5. Validation and schemas

### 5.1 Where Zod runs (and nowhere else)

| Boundary | Schema lives in | Parsed by |
| --- | --- | --- |
| HTTP request (body/query/params) | `contracts/vN` | API `validate*` middleware |
| HTTP response (in the dashboard) | `contracts/vN` | web API client (tolerant parse) |
| Form input | `contracts/vN` request schema | web `.action.ts` |
| Webhook payload | `integrations/<p>/vN/*.provider-schema.ts` | connector `parse` |
| Provider API response | same | connector |
| Task payload | `tasks/src/payloads/vN` | the task |
| Environment | `env` | entrypoint, once |

Domain and application **never** import Zod. Their inputs are already trusted types.

### 5.2 Schema file pattern (`contracts`)

```ts
// packages/contracts/src/v1/exceptions/close-exception.schema.ts
import { z } from "zod";
import { EXCEPTION_RESOLUTIONS } from "@repo/domain";

export const CloseExceptionRequestSchema = z.strictObject({
  resolution: z.enum(EXCEPTION_RESOLUTIONS),
  note: z.string().trim().min(1).max(2_000),
});
export type CloseExceptionRequest = z.infer<typeof CloseExceptionRequestSchema>;

export const CloseExceptionResponseSchema = z.object({ data: ExceptionSchema });
export type CloseExceptionResponse = z.infer<typeof CloseExceptionResponseSchema>;
```

Rules:

- **Requests are `z.strictObject`** (reject unknown keys); **responses are `z.object`**
  (tolerant reader on the client).
- Constants come from `@repo/domain` so the contract cannot drift from the rules.
- Timestamps are ISO-8601 UTC strings in contracts; `Date` appears only inside `db`.
- Money on the wire: `{ amountMinor: number(int), currency: "USD" }`. Never floats.
- Ids on the wire are plain strings; the use-case mapper brands them.
- One file per endpoint payload pair plus shared entity schemas in `<area>/entities.schema.ts`.
- A schema file exports schemas **and** their inferred types and nothing else.

### 5.3 Compatibility inside a version

Allowed without a new version: **adding an optional field to a response.** Everything else —
new required request field, tightened or loosened validation, removed/renamed/retyped field,
changed meaning, changed status code — is a new version. When in doubt, new version.

---

## 6. Dashboard forms and actions (summary; full pattern in `apps/web/ARCHITECTURE.md`)

- A **form** is a client component using React 19 `useActionState` bound to an **action**.
- An **action** has the signature
  `(prev: ActionState<T>, formData: FormData) => Promise<ActionState<T>>`:
  parse `FormData` with the contract request schema → call the typed API client → return
  `ActionState`. It never throws to the UI.
- `ActionState<T>` is one shared union:
  `{ status: "idle" } | { status: "success"; data: T } | { status: "invalid"; fieldErrors; formError? } | { status: "failed"; error: ApiErrorView }`.
- The same contract schema validates in the browser and is enforced again by the API.

---

## 7. Logging and observability

- `Logger` is a port in `@repo/domain` (`debug|info|warn|error(event, fields)`), implemented
  once in the API and once in tasks. `event` is a stable dotted name (`exception.closed`);
  messages are not interpolated sentences.
- Mandatory fields when known: `requestId`, `shopDomain`, `orderId`, `webhookEventId`,
  `useCase`, `provider`, `durationMs`.
- **Redaction** is applied in the logger implementation (keys: `authorization`, `cookie`,
  `secret`, `token`, `apiKey`, `password`, `hmac`, address fields, customer email/phone).
  Callers still must not pass secrets.
- One `requestId` per inbound request (accepted from a trusted header only if validated,
  otherwise generated), returned in the `x-request-id` header and the error envelope, and
  propagated into task payloads as `traceId`.

---

## 8. Identity, time, money

- Ids are generated through an `IdGenerator` port (random, unguessable, prefixed:
  `ord_…`, `exc_…`). Never derive an id from a timestamp or a sequence.
- Time comes from a `Clock` port. Tests use a fixed clock.
- `Money` = integer minor units + currency; arithmetic only through `@repo/domain` money
  functions; different currencies never add.
- Database timestamps are `timestamptz`, written by the database (`now()`) or by the injected
  clock inside a transaction — one consistent choice per table, documented in its schema file.

---

## 9. Adding a feature: the fixed order

Every feature is a vertical slice built **in this order**. Skipping ahead is how patterns fork.

1. **Define the change** (AGENTS §10 step 2): requirement, versions affected, failure cases,
   tests. Pick the target version (new feature ⇒ current open version, usually `v1`).
2. **`domain`** — types, constants, pure rules, state transitions. Tests first; no database.
3. **`contracts/vN`** — request/response schemas for any public surface.
4. **`application/vN`** — port(s), then the use case with its `Deps`/`Input`/`Outcome`.
   Test with in-memory fakes.
5. **`db`** — schema change as an **expand-only** migration, then the repository
   implementing the port. Integration-test against a real database.
6. **`integrations`** — only if an external system is involved; connector + fake + fixtures.
7. **`apps/api/vN`** — mapper, route, composition wiring, route tests (the mandatory matrix).
8. **`tasks`** — only if work is long-running/retryable; payload schema + thin task.
9. **`apps/web/features/vN`** — client, action, form/components, status maps, tests.
10. **Docs** — update the relevant `ARCHITECTURE.md`/`INSTRUCTIONS.md` if a convention moved;
    **append to `changes.md`**.
11. **Verify** — typecheck, lint, tests, build for every touched workspace; report only what ran.

A change that must alter an existing public contract stops at step 1 and becomes a **new
version** (add `v2/` siblings in steps 3, 4, 7, 9), not an edit.

---

## 10. Testing

Runner: **`bun test`**. Tests sit next to the code (`x.ts` ↔ `x.test.ts`).

| Level | Where | Uses | Speed |
| --- | --- | --- | --- |
| Domain | `domain` | nothing | ms; run constantly |
| Use case | `application` | in-memory fakes from `@repo/application/testing` | ms |
| Repository / DB | `db` | real PostgreSQL; skips with a reason when unreachable; `SKIP_DB_INTEGRATION=1` to opt out | seconds |
| Connector | `integrations` | recorded fixtures + fake HTTP; never the live provider | ms |
| Route | `apps/api` | `app.request()` with fake use cases | ms |
| Task | `tasks` | fake use case; asserts retry/throw semantics | ms |
| Web logic | `apps/web` | pure functions, schemas, client with fake `fetch` | ms |

**Mandatory route test matrix** (every endpoint, every version): happy path; missing/invalid
auth (401); authenticated but not permitted (403); wrong-shop access returns `not_found`
(never `forbidden`/`already_*`); malformed input (400/422) with the guard running **before**
parsing for unauthenticated callers; each outcome → status mapping; error envelope shape and
`x-request-id`; CORS headers present **on error responses**.

**Mandatory connector tests:** valid fixture → internal type; each documented provider error →
expected `AppError` code/retryable; timeout → `dependency_timeout`; schema-violating provider
response → `dependency_failed` (not a crash); no secret appears in captured logs.

**Compatibility tests (the version guarantee).**
`__fixtures__/vN/*.json` hold frozen request/response/payload examples. Each version's test
suite asserts every fixture still parses, and (for responses) that a golden use-case run still
serializes to the same JSON. Fixtures of a released version are **never edited** — a
changed expectation means a new version. CI runs all versions' suites on every change; a
`v2` change that breaks a `v1` test is a defect, not a test update.

**Concurrency tests** assert the guarantee, not merely the result (README's contention and
close-race tests are the model): verify by temporarily removing the lock/constraint and
confirming the test fails.

Never mark a check as passing in `changes.md` unless it was run and its output read.

---

## 11. Documentation and change tracking

- Every modification — code, config, docs, schema, tests — gets an entry in the root
  `changes.md` (format at the top of that file). Entries are appended, never rewritten.
- Touching a convention ⇒ update the owning `ARCHITECTURE.md`/`INSTRUCTIONS.md` **in the same
  change**.
- Each new versioned component documents the AGENTS §4.8 list: purpose/interface, I/O types,
  validation, dependencies, supported versions of other components, error behavior, tests,
  deprecation path. The per-package docs carry a "Compatibility" table for this.

## 12. Deprecating and retiring a version

1. Announce in the version's `README`/section and `changes.md`; add `Deprecation`/`Sunset`
   response headers from `v1/deprecation.ts`.
2. Keep all of its tests passing until retirement.
3. Retire only after traffic is confirmed zero and an approved migration plan exists; delete the
   `vN/` folders in one change across contracts, application, db repos, api, web, tasks.
4. Database contract-phase migrations (dropping old columns) happen **after** step 3.

## 13. Lint-enforced rules (Phase 0)

`no-restricted-imports` configured in `@repo/eslint-config`:
`application ↛ contracts|db|integrations|tasks|auth`, `domain ↛ anything`,
`v2 ↛ v1` (and reverse), no relative imports across package roots, no `process.env` outside
`@repo/env` and entrypoints, no default exports (except Next.js files), no `console.*` outside
entrypoints. Anything not lint-enforceable is a review-checklist item in `changes.md` entries.
