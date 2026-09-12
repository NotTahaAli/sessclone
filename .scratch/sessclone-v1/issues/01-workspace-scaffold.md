# 01: Workspace scaffold, licences, CI green

**What to build:** A contributor clones the repo, runs one install command, and gets a working pnpm workspace with the four packages in place, linting and typechecking clean, and CI reporting green on push.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] pnpm workspace with `apps/web`, `packages/plugin`, `packages/shared`, `supabase/`
- [ ] TypeScript, lint, and format configured once at the root and inherited
- [ ] Every dependency version looked up from the registry, never recalled, and pinned exactly
- [ ] AGPL-3.0 for the application, MIT for `packages/plugin`, licence field set per package
- [ ] CI runs lint, typecheck, and test on push and reports green
