# 76: Collector — Device key on cloud environments

**What to build:** A cloud environment reports as one Device across every
container it boots, rather than minting a new Device each time.

**Blocked by:** 30, 32, 74.

**Status:** ready-for-agent

- [ ] Device key read from configuration where the environment supplies no stable machine identity
- [ ] The machine key remains the default; configuration overrides it rather than the other way round
- [ ] A cloud environment that sets nothing is recorded as such rather than silently keyed on the container
- [ ] The variable is in `docs/configuration.md` and `.env.example`, with the note that a Projects environment sets it in its environment settings rather than a shell profile
- [ ] Covered by a test that a second container with the same configuration is the same Device

**Started, not finished.** `packages/plugin/src/device.ts` is the decision, and
it turned out to need less configuration than this ticket assumed. Claude Code
sets `CLAUDE_CODE_ACCOUNT_UUID` in a remote environment and it outlives the
container, which is ticket 30's "keyed by account, not container" already in
the environment. So: `SESSCLONE_DEVICE` when set, the account when remote, the
machine key otherwise, and `container` as the last resort with the source
recorded so a per-container key is legible as one rather than passing for a
laptop. Seven tests in `device.test.ts`, including two containers on one
account resolving to one Device.

`SESSCLONE_DEVICE` survives as the override for an account running several
environments that should count separately, since the account key makes them
one. `docs/configuration.md` and `.env.example` say that, and say a Projects
environment sets it in its environment settings rather than a shell profile.

What is left needs ticket 30: the machine key itself is that ticket's, and this
function takes it as an argument rather than computing a second one beside it.
That thread found the account variable independently and is recording it in
finding 06 — the two need to agree on one spelling before either ships.
Nothing calls `deviceKey` yet; the thing that would is the real Collector,
which is ticket 35's.
