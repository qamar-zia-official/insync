# changes.md

Append-only history of every project modification (AGENTS.md §9). Never replace or summarize
earlier entries. Newest entries go at the **bottom**.

Entry format:

```
## YYYY-MM-DD — <title>
- **What changed:**
- **Why:**
- **Modules / versions affected:**
- **Contract / schema / migration implications:**
- **Tests / verification performed:**
- **Known limitations / follow-up:**
```

---

## 2026-10-17 — Phase −1: architecture and build-plan documentation (docs only)

- **What changed:** Added documentation files only. No source, config, schema, or test
  changed.
  - Root: `ARCHITECTURE.md`, `CONVENTIONS.md`, `PLAN.md`, `changes.md` (this file).
  - Apps: `apps/api/ARCHITECTURE.md`, `apps/web/ARCHITECTURE.md`.
  - Packages: `ARCHITECTURE.md` for `contracts`, `application`, `db`, `integrations`;
    `INSTRUCTIONS.md` for `domain`, `tasks`, `auth`, `env`, `ui`, `eslint-config`,
    `typescript-config`.
  - Existing `AGENTS.md`, `apps/web/AGENTS.md`, `README.md` were **not** modified.
- **Why:** AGENTS.md §5 and §10 require an `ARCHITECTURE.md` per major app/subsystem and a
  documented implementation pattern before code. The request was to define the architecture,
  the build order, and every function/connector/validator/form/action pattern first, with no
  implementation in this run.
- **Modules / versions affected:** none at runtime. The docs define `v1` as the first version of
  api, contracts, application, db repositories, connectors, task payloads, and dashboard
  features.
- **Contract / schema / migration implications:** none made. Planned (not applied): new
  packages `domain`, `contracts`, `application`, `db`, `auth`, `env`, `tasks`; explicit
  `exports` maps; expand-only migrations from Phase 2 onward.
- **Findings recorded from inspecting the upload (not yet fixed; scheduled in PLAN Phase 0):**
  1. README describes Phases 1–6 as built with ~13 packages; the upload and `bun.lock`
     contain only `apps/api`, `apps/web`, `@repo/eslint-config`, `@repo/integrations`,
     `@repo/typescript-config`, `@repo/ui`. `packages/integrations/src` is empty.
  2. `apps/api` is the Vercel "Hello Hono" starter (package name `hono`, stray
     `pnpm-workspace.yaml`, npm/Vercel README, no scripts); `apps/web` is the unmodified
     create-next-app page with no `typecheck`/`test` scripts.
  3. Version drift: `typescript` 7.0.2 (root) vs `^5` (web); `@types/node` `^26` vs `^20`;
     `eslint` 10.9.1 vs `^9` (web); `react` 19.3.0 (web) vs 19.2.8 (ui); `bun` 1.4.0 (root)
     vs 1.4.3 (web `packageManager`).
  4. `packages/ui` has a `generate:component` script with no Turbo generator.
  5. `AGENTS.md` conflicts with README on versioning, `contracts` vs `validation`, and a single
     `allocated_warehouse_id`; AGENTS.md was followed (ARCHITECTURE.md D-01–D-12).
  6. No `INSTRUCTIONS.md` or `ARCHITECTURE.md` existed anywhere before this change.
  7. The upload includes a populated `.env`; its values were not read into any document.
     Treat as exposed if the zip was shared.
  8. Shopify's own pages disagree on the duplicate-detection header (`X-Shopify-Event-Id` vs
     `X-Shopify-Webhook-Id`); ARCHITECTURE §6.1 chooses delivery-id dedupe plus event-id
     correlation and requires re-verification in Phase 2.
- **Tests / verification performed:** No code exists, so typecheck, lint, tests, and build
  were **not run** and nothing is claimed about them. Performed: read of AGENTS.md (root and
  web), README, package manifests, tsconfigs, `turbo.json`, `.env.example`; `.env` read for
  variable names only. A script check of the new documents ran: relative links and anchors,
  mentioned `ARCHITECTURE.md`/`INSTRUCTIONS.md` paths, and `CONVENTIONS §N` references all
  resolve (0 problems across 17 files). This checks internal consistency of the docs only; it
  does not verify the plan against running code.
- **Known limitations / follow-up:**
  - `node_modules` was not in the upload, so `apps/web/AGENTS.md`'s instruction to read
    `node_modules/next/dist/docs/` could not be followed. `apps/web/ARCHITECTURE.md` §0 lists
    what must be verified before any web code; Next.js API statements in that file are
    intentions, not confirmed facts.
  - New package folders contain only documentation until Phase 0 adds `package.json`. Not
    verified: whether `bun install` accepts the `packages/*` glob with directories lacking a
    `package.json` (it was not run). If it complains, move the docs in with their packages in
    Phase 0.
  - Open questions Q1–Q5 in `ARCHITECTURE.md` §8 use stated defaults until answered.
  - Third-party specifics (Trigger.dev v4 wait/token features, Better Auth options, Zod 4
    helper names, TanStack Query dependency) were not verified against current docs and must
    be checked in the phase that uses them.
