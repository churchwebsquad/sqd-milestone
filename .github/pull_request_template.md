<!--
  Before opening: make sure you're on a squad-prefixed branch
  (brand/<task> or social/<task>) — never push to main.
-->

## What this PR does


## Squad
- [ ] Brand
- [ ] Social
- [ ] Shared (I flagged Ashley before opening this)

## Verification checklist
- [ ] Changes stay within my squad's folders. If they reach past my domain
      (App.tsx routing, AuthContext, shared Churches Dashboard scaffolding,
      another squad's folders), I flagged Ashley **before** opening this PR.
- [ ] **No new Supabase tables.** Need one? I opened a "Request a table" issue
      and linked it below.
- [ ] Schema changes are **`ADD COLUMN` only**, in a new `/schema/vNN_*.sql`
      file (next number in sequence). No `CREATE TABLE` / `DROP`.
- [ ] No credentials, API tokens, or keys hardcoded — `.env` only.
- [ ] No edits to `AuthContext.tsx`, `admin.ts`, `supabase.ts`, or `.github/`.
- [ ] Added a `CHANGELOG.md` entry (and a `/whats-new` release note if
      user-facing).
- [ ] `npm run typecheck` and `npm run lint` pass locally.

## Linked issues (e.g. table requests)


## Screenshots / notes for Ashley

