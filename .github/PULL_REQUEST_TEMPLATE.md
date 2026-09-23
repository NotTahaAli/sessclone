## Summary

<!-- What changes, and why. -->

## Linked issue or ticket

<!-- Closes #123, or the ticket under .scratch/ this implements. -->

## How it was tested

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:db` (needs a local Postgres; see `README.md`)
- [ ] `pnpm format`

<!-- Anything tested by hand, and how. -->

## Screenshots

<!--
For any change a person will see: 1440x900 and 390x844, each in light and
dark. Delete this section otherwise.
-->

## Checklist

- [ ] Every commit is signed off (`git commit -s`) — see `CONTRIBUTING.md`.
- [ ] A new table ships with its RLS policies in the same migration.
- [ ] Input at trust boundaries is validated with zod.
- [ ] No secrets, keys or real transcripts in the diff, tests or fixtures.
