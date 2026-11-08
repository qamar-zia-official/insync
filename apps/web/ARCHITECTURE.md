# apps/web — ARCHITECTURE

The operations dashboard. Next.js 16 (App Router), React 19, Tailwind v4, `@repo/ui`.
**Presentation of persisted state only.** Read root `AGENTS.md`, `ARCHITECTURE.md`,
`CONVENTIONS.md`, and `apps/web/AGENTS.md` first.

## 0. Verified Next.js rules — MUST be filled in Phase 0

`apps/web/AGENTS.md` states this Next.js version has breaking changes and that its docs in
`node_modules/next/dist/docs/` must be read before writing code. **`node_modules` was not in the
uploaded zip, so none of that was read and nothing below about Next.js APIs is verified.**
Statements marked ⚠ are intentions to be confirmed against those docs.

Before the first web change, run `bun install`, read the relevant guides, and replace this
table with confirmed facts (file conventions, `LayoutProps`/`PageProps` helper types, what
`cacheComponents: true` and `partialPrefetching: true` (both set in `next.config.ts`) require
of pages that read per-user data, `use client` placement, middleware/proxy naming, font and
env handling).

| Topic | Confirmed rule (doc path) | Status |
| --- | --- | --- |
| Route file conventions (`page`, `layout`, `loading`, `error`) | | ☐ to read |
| Typed props helpers (`LayoutProps<"/">` is already used in `layout.tsx`) | | ☐ to read |
| Effect of `cacheComponents` on dynamic/per-user rendering | | ☐ to read |
| Effect of `partialPrefetching` | | ☐ to read |
| Environment variable handling for `NEXT_PUBLIC_*` in a monorepo | | ☐ to read |
| Tailwind v4 integration (`@tailwindcss/turbopack` in config) | | ☐ to read |

## 1. Pattern

**Versioned feature folders + thin routes + a typed API client.** Pages in `app/` are thin shells
that mount components from `features/vN/<feature>/`. Features talk to the Hono API from the
**browser** with `credentials: "include"`; there is no server-side proxy.

Why the browser calls the API directly (kept from README, do not "simplify" it away): the
session cookie is `HttpOnly` + `SameSite=Lax` and belongs to the API origin. A Server Component
reading it works on `localhost` (cookies ignore ports) and silently renders an empty queue the
moment dashboard and API sit on different subdomains. Sending the cookie (not reading it) works
in every topology and keeps `HttpOnly`. Consequence: dashboard and API must share a registrable
domain (`app.` + `api.` OK; different registrable domains are not).

This is why **"actions" here are typed client functions, not Next.js Server Actions** (D-05).
Their signature matches the Server Action shape, so moving one server-side later is
mechanical. Revisit only if a same-origin proxy is introduced.

## 2. Layout

```
apps/web/
  ARCHITECTURE.md  AGENTS.md  package.json  next.config.ts  tsconfig.json
  app/                                  # Next route files ONLY. Thin. default exports allowed here.
    layout.tsx
    (auth)/sign-in/page.tsx
    (console)/layout.tsx                # app shell (nav, shop picker)
    (console)/exceptions/page.tsx       # → <ExceptionsQueue /> from features/v1/exceptions
    (console)/orders/[orderId]/page.tsx
    v2/…                                # only when a v2 dashboard exists; mounted under /v2
  features/
    v1/                                 # consumes API v1 — declared in meta.ts
      meta.ts                           # export const API_VERSION = "v1" as const
      exceptions/
        api/
          exceptions.client.ts          # listExceptions(), closeException() — typed, envelope-aware
          exceptions.query-keys.ts      # query key factory
        actions/
          close-exception.action.ts
        forms/
          close-exception.form.tsx
        components/
          exceptions-queue.tsx          # client component (data + table)
          exception-status-badge.tsx
        status.ts                       # exhaustive Record<ExceptionStatus, BadgeView>
        index.ts                        # public surface of the feature (components only)
      orders/ …
      shipments/ …
  lib/                                  # version-agnostic, no feature knowledge
    api-client.ts                       # fetch wrapper: base URL, credentials, envelope parse, error mapping
    api-error.ts                        # ApiError → ApiErrorView (what the UI may display)
    action-state.ts                     # ActionState<T> union + helpers
    format.ts                           # dates, ages, money formatting
    shop-domain.ts                      # normalisation of shop input
    auth-client.ts                      # @repo/auth/client wrapper
    public-env.ts                       # parsed NEXT_PUBLIC_* via @repo/env
  components/                           # app shell only (not feature components)
```

## 3. Data flow

```
Page (server shell) ─► Feature component ("use client")
                            │  useQuery(key, () => client.list(...))       (reads)
                            │  <form action={formAction}>                  (writes)
                            ▼
                     *.client.ts  ──►  lib/api-client.ts ──► fetch(API, credentials: "include")
                            ▲                                   │
                            └──── contracts/v1 schema parse ◄───┘  (tolerant: z.object)
```

Display values come from the response; no business rule is computed in a component (status
meaning, allowed transitions, shippability come from `@repo/domain` or from the API).

## 4. The API client pattern

```ts
// features/v1/exceptions/api/exceptions.client.ts
import { ListExceptionsResponseSchema, type ListExceptionsQuery } from "@repo/contracts/v1";
import { apiGet, apiPost } from "../../../../lib/api-client";

export function listExceptions(query: ListExceptionsQuery) {
  return apiGet({ path: "/v1/exceptions", query, schema: ListExceptionsResponseSchema });
}
```

- One function per endpoint; named like the use case (`listExceptions`, `closeException`).
- `apiGet`/`apiPost` build the URL from `NEXT_PUBLIC_API_URL`, add `credentials: "include"`,
  parse the success body with the contract response schema, and convert the error envelope to
  `ApiError { code, requestId, status, fieldErrors? }`. A network failure becomes
  `ApiError{ code: "network" }`.
- The client never invents a default for a field the API omitted; a schema failure is an error
  shown with the request id.
- The version in the path comes from `meta.ts` (`API_VERSION`), so a dashboard version declares
  the contract it consumes in exactly one place.

## 5. The action pattern

```ts
// features/v1/exceptions/actions/close-exception.action.ts
import { CloseExceptionRequestSchema } from "@repo/contracts/v1";
import type { ActionState } from "../../../../lib/action-state";
import { toActionFailure, toFieldErrors } from "../../../../lib/action-state";
import { closeException } from "../api/exceptions.client";

export async function closeExceptionAction(
  _prev: ActionState<ExceptionView>,
  formData: FormData,
): Promise<ActionState<ExceptionView>> {
  const parsed = CloseExceptionRequestSchema.safeParse({
    resolution: formData.get("resolution"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { status: "invalid", fieldErrors: toFieldErrors(parsed.error) };

  const exceptionId = String(formData.get("exceptionId") ?? "");   // validated by the API too
  try {
    const result = await closeException(exceptionId, parsed.data);
    return { status: "success", data: result.data };
  } catch (error) {
    return toActionFailure(error);          // ApiError → { status: "failed" | "invalid", … }
  }
}
```

Rules: one action per file; first parameter is the previous state (React 19 `useActionState`),
second is `FormData`; **never throws** to the UI; validates with the contract schema, then
relies on the API for authorization and final validation; success returns persisted data
from the response (not what the form sent).

`ActionState<T>`:

```ts
type ActionState<T> =
  | { status: "idle" }
  | { status: "success"; data: T }
  | { status: "invalid"; fieldErrors: Record<string, string[]>; formError?: string }
  | { status: "failed"; error: ApiErrorView };     // includes requestId for support
```

## 6. The form pattern

```tsx
// features/v1/exceptions/forms/close-exception.form.tsx
"use client";
export function CloseExceptionForm({ exceptionId, onClosed }: Props) {
  const [state, formAction, pending] = useActionState(closeExceptionAction, { status: "idle" });
  useEffect(() => { if (state.status === "success") onClosed(state.data); }, [state, onClosed]);
  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <FormField label="Resolution" error={state.status === "invalid" ? state.fieldErrors.resolution : undefined}> … </FormField>
      <FormField label="Note" required error={…}> <textarea name="note" /> </FormField>
      <FormError state={state} />                       {/* shows requestId for "failed" */}
      <Button type="submit" disabled={pending}>Close exception</Button>
    </form>
  );
}
```

Rules: one form per file; `name` attributes equal the contract field names; field errors keyed
by contract field path; shared primitives (`FormField`, `FormError`, `Button`, `Input`) come
from `@repo/ui`; a form never calls `fetch` itself; no local validation rules beyond the
contract schema.

## 7. Queries and mutations

TanStack Query (D-09, added in Phase 5 after confirmation). Query keys come from a
`*.query-keys.ts` factory per feature (`exceptionsKeys.list(shopDomain, filters)`); every key
includes the shop scope. After a successful action the component invalidates the affected keys
instead of patching the cache optimistically — the UI shows what the server persisted.

## 8. Rendering persisted state honestly

- Each state-bearing feature has `status.ts` with an **exhaustive** `Record<Status, View>`
  (labels, tone). A new domain state is a compile error until it has a view.
- "Dispatched", "shipped", "delivered" appear only when the order/shipment response contains
  the persisted state **and** its evidence (carrier event timestamp / tracking number).
  Otherwise the UI shows "pending carrier confirmation".
- Loading, empty, error, and forbidden are four distinct states in every list view.
  401 → "sign in"; 403 → "signed in but not allowed" (kept distinct); error views show the
  `requestId`.
- Until per-shop membership exists, the console states on screen that operator access spans all
  merchants (README).

## 9. Authentication in the UI

`lib/auth-client.ts` wraps the Better Auth browser client from `@repo/auth/client`. Route
groups: `(auth)` public, `(console)` requires a session — enforced by the API (401), with the
UI redirecting on 401, not by trusting a client-side flag. The last-used shop domain may be
remembered in `localStorage` (a convenience, never an authorization input).

## 10. Dashboard versioning

`features/v1` consumes API `v1` and its `meta.ts` says so. A new dashboard version is created
only when the API contract, state model, component behavior, or layout must change
incompatibly: add `features/v2/`, mount `app/v2/…` routes, keep `features/v1` intact while
compatibility is required. `v2` never imports from `v1`. Shared, behavior-free pieces live in
`@repo/ui` and `lib/`.

| Component | Supports |
| --- | --- |
| `features/v1` | API `v1`, `contracts/v1`, domain constants (additive) |
| `lib/*` | all dashboard versions; behavior-compatible changes only |

## 11. Tailwind and UI

Primitives (Button, Input, Table, Dialog, Badge, FormField, FormError, Card) live in
`@repo/ui`, are presentational, and contain no feature or data logic. Feature components
compose them. Styling is Tailwind utilities; no per-feature CSS files. Tailwind must scan
`packages/ui` sources — verify in Phase 0 (§0).

## 12. Testing

- **Logic tests (`bun test`)** for pure modules: `shop-domain`, `format`, query builders,
  `toActionFailure`, `toFieldErrors`, `status.ts` exhaustiveness, API client error mapping with
  a fake `fetch`.
- **Action tests**: call the action with a `FormData` and a fake client; assert `invalid` /
  `success` / `failed` states and that it never throws.
- **Contract compatibility**: parse the frozen `contracts/v1` response fixtures with the
  client's schemas.
- Component rendering is **not** proven by these tests; verify each new view against a running
  API with a real record and record that in `changes.md` (README's vertical-slice check).

## 13. How to add a feature without breaking anything

1. API endpoint + contracts exist for the target version (CONVENTIONS §9).
2. `features/v1/<feature>/api/<feature>.client.ts` + query keys.
3. `status.ts` if the feature shows a stateful entity.
4. `actions/*.action.ts` for each mutation + tests.
5. `forms/*.form.tsx` and `components/*`.
6. `index.ts` exporting only components the route needs.
7. `app/(console)/<feature>/page.tsx` — a thin shell importing from `features/v1/<feature>`.
8. Tests; manual vertical slice; docs; `changes.md`.

Never edit `features/v1` to consume a v2 endpoint — build the `v2` feature.
