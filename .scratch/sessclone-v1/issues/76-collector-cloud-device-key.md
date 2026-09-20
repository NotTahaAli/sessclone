# 76: Collector — Device key on cloud environments

**What to build:** A cloud environment reports as one Device across every
container it boots, rather than minting a new Device each time.

**Blocked by:** 30, 32, 74.

**Status:** closed

- [x] Device key read from configuration where the environment supplies no stable machine identity
- [x] The machine key remains the default; configuration overrides it rather than the other way round
- [x] A cloud environment that sets nothing is recorded as such rather than silently keyed on the container
- [x] The variable is in `docs/configuration.md` and `.env.example`, with the note that a Projects environment sets it in its environment settings rather than a shell profile
- [x] Covered by a test that a second container with the same configuration is the same Device

**Closed into ticket 30, which turned out to own it.** This ticket was written
believing a cloud container had no stable identity a hook process could read,
and that a Member would have to supply one. That was wrong:
`CLAUDE_CODE_ACCOUNT_UUID` is set in a remote environment and outlives the
container, which is what ticket 30 always meant by "keyed by account, not
container".

`deviceKey` therefore lives in `packages/shared/src/identity.ts`, ticket 30's
own file, and keys a cloud session as `cloud:<account uuid>`, with
`:<type>` appended when `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE` is not
`cloud_default`, and `host:<hostname>` otherwise. The `SESSCLONE_DEVICE`
override, for an account running several environments that should count
separately, is ticket 30's to add along with its rows in
`docs/configuration.md` and `.env.example`.

A second implementation was written here before that was known, in
`packages/plugin/src/device.ts`, and has been deleted rather than left to
drift. The Collector calls `deviceKey` from `@sessclone/shared` when ticket 35
builds it; spec §Packages puts logic beyond orchestration in shared, and this
was logic.

The one thing the deleted copy had that the surviving one does not is a
`source` field saying which rule produced the key, so a container-keyed Device
would be legible as one on a dashboard. Nothing asked for it and nothing
consumed it. It belongs in ticket 56 if a per-Device breakdown ever needs to
explain itself.
