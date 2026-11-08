# packages/tasks — INSTRUCTIONS

Package: `@repo/tasks`. **Trigger.dev v4 tasks. Thin: validate payload → build deps → call a use
case → translate the outcome.** Business logic lives in `application`/`domain`. Planned
(Phase 4); does not exist yet.

## Layout

```
packages/tasks/
  package.json          # exports: "./dispatcher" (FulfillmentJobDispatcher implementation)
  trigger.config.ts
  src/
    composition.ts      # the tasks runtime's OWN composition root (separate process from the API)
    payloads/
      v1/
        route-order.payload.ts      # Zod payload schemas, versioned: in-flight jobs must keep parsing
    tasks/
      run-routing-pass.task.ts      # cron every 5 min + manual trigger
      route-order.task.ts
      create-shipments.task.ts …
    dispatcher/
      trigger-job-dispatcher.ts     # implements application FulfillmentJobDispatcher
```

## Rules

1. **Payload = durable reference + idempotency key + `traceId`**, never entity bodies and never
   anything that depends on an HTTP request. Parsed with the version's payload schema first;
   a parse failure is a **non-retryable** failure with a logged reason.
2. **A task body is ≤ ~20 lines:** parse → `composition` deps → `useCase(input)` → outcome map.
3. **Retry policy is declared per task** as a named constant (max attempts, backoff). Retry only
   what is safe: use cases are idempotent by design; confirm that before enabling retries for a
   task that talks to a carrier (idempotency key + reconcile).
4. **Outcomes → task result:** business outcomes (`not_routable`, `already_allocated`) are
   *successful runs* with a returned summary. Faults propagate (`throw`) so Trigger.dev retries
   when `retryable`.
5. **Batch tasks** isolate per-item failures, continue the batch, and **throw after** the batch
   if anything failed, so a pass never reports green having routed nothing (README Phase 5).
6. **Human approval**: workflow state lives in the DB (`decisions`); the run ends when approval
   is required and a separate use case resumes the flow after a decision. Do not depend on an
   in-memory wait. Verify Trigger.dev's wait/token features against current docs before using
   them in Phase 8.
7. **Structured logging** through the shared `Logger` with `traceId`, task name, attempt.
8. Task ids are stable strings (`routing.run-pass`); renaming one is a breaking change.
9. Environment: loaded via `@repo/env` (`bun --env-file=../../.env` for the local worker).

## Tests

Fake use case + fake clock: assert payload parsing, outcome mapping, retry vs non-retry
classification, "bad item does not stop the batch but the batch fails", and "idle pass is
quiet". Task wiring is thin enough that most coverage belongs to the use cases.

## Compatibility

`payloads/v1` is supported by `application/v1`. Adding `payloads/v2` never removes v1; the
dispatcher can enqueue either until v1 jobs drain.
