# packages/ui — INSTRUCTIONS

Package: `@repo/ui` (exists; currently the Turborepo template's `button`, `card`, `code`).
**Presentational primitives shared by dashboard versions.** No data fetching, no feature or
domain logic, no knowledge of the API.

## Layout

```
packages/ui/src/
  button.tsx  card.tsx  input.tsx  textarea.tsx  select.tsx  badge.tsx  table.tsx
  dialog.tsx  form-field.tsx  form-error.tsx  empty-state.tsx  spinner.tsx
```

Exports are `"./*": "./src/*.tsx"` (import as `@repo/ui/button`). One component per file,
kebab-case file, named export.

## Rules

1. **Primitives only.** If a component needs to know what an "exception" or "shipment" is, it
   belongs in `apps/web/features/vN/<feature>/components/`.
2. **Behavior-free sharing.** Changing a primitive must not change what a version's feature
   *does*, only how it looks/is accessible. A behavioral change gets a new component name.
3. **Props are explicit and typed**; no `any`; pass `className` for composition; forward refs
   where form controls need them.
4. **Accessible by default:** labels bound to inputs, focus states, `aria-invalid` +
   `aria-describedby` for errors (used by `FormField`/`FormError`).
5. **Styling:** Tailwind utilities; Tailwind must scan this package from `apps/web` (verify in
   Phase 0).
6. **React/React-DOM versions** must match `apps/web` (currently drifting: `19.2.8` vs
   `19.3.0` — align in Phase 0).
7. Remove template-only components that are unused; remove the `generate:component` script
   unless a Turbo generator is added.

## Tests

Logic-free; verify accessibility attributes with light render tests only if a test renderer is
added deliberately. Otherwise primitives are covered by the feature vertical-slice checks.
