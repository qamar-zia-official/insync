# packages/eslint-config — INSTRUCTIONS

Package: `@repo/eslint-config`. **Shared lint rules**; exports `./base`, `./next-js`,
`./react-internal`. The README in this folder is the unmodified Turborepo template text; leave
it or rewrite it, but this file is authoritative.

## Rules

1. Every workspace's `eslint.config.js` imports from here; no workspace defines its own
   competing rule set (the web app currently uses `eslint-config-next` directly — Phase 0
   decides whether it layers `./next-js` on top or documents the exception).
2. **Architectural rules live here** (added Phase 0, per `CONVENTIONS.md` §13):
   `no-restricted-imports` for the dependency matrix in `ARCHITECTURE.md` §3; `v1 ↔ v2`
   isolation; no cross-package relative imports; no `process.env` outside `@repo/env` and
   entrypoints; no default exports outside Next.js files; no `console.*` outside entrypoints.
3. **`--max-warnings 0`** is the standard for the `lint` scripts. Note: the base config loads
   `eslint-plugin-only-warn`, which downgrades errors to warnings — combined with
   `--max-warnings 0` it still fails the run, but review whether `only-warn` should remain.
4. Changing a rule can fail every workspace: run `bun run lint` repo-wide and record the
   result in `changes.md`.
5. The `turbo/no-undeclared-env-vars` rule stays on; it backs the three-place env rule.
6. ESLint version drift (`10.9.1` here vs `^9` in `apps/web`) is resolved in Phase 0.
