# packages/typescript-config — INSTRUCTIONS

Package: `@repo/typescript-config`. Shared `tsconfig` bases: `base.json`, `nextjs.json`,
`react-library.json`.

## Rules

1. **Every workspace extends one of these**; none redefines `strict`. `base.json` is the
   strictness floor (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`).
2. Choose by workspace kind:

   | Workspace | Extends | Notes |
   | --- | --- | --- |
   | `domain`, `application`, `contracts`, `db`, `integrations`, `auth`, `env`, `tasks`, `apps/api` | `base.json` | Override `module: "ESNext"`, `moduleResolution: "Bundler"`, `types: ["bun"]` as `packages/integrations` already does; `noEmit: true` |
   | `apps/web` | `nextjs.json` | Currently `apps/web/tsconfig.json` is standalone (create-next-app) — extend the shared config in Phase 0, keeping Next's required `plugins`/`include` |
   | `packages/ui` | `react-library.json` | |

3. **`apps/api/tsconfig.json`** currently uses `NodeNext`, `rootDir: ./src`, `outDir`, and Hono
   JSX settings — replace with the shared base unless JSX is actually used.
4. `base.json` sets `declaration`/`declarationMap`; workspaces that only typecheck set
   `noEmit: true`. Packages are consumed from source via `exports`, not built output.
5. Version alignment: root `typescript` is `7.0.2`; `apps/web` declares `^5` — align (Phase 0)
   and confirm `eslint`/`next` tooling accepts it.
6. **No workspace may loosen `strict`** to make code compile; fix the code or document a
   narrowly scoped exception in `changes.md`.
