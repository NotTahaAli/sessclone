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

**Started, not finished.** `packages/plugin/src/device.ts` is the decision:
`SESSCLONE_DEVICE` when set and non-blank, the machine key otherwise, and the
source recorded as `configured`, `machine`, or `container` — that last one for
a cloud environment that named no Device, so a per-container key is legible as
one instead of passing for a laptop. Five tests in `device.test.ts`, including
the one that matters: two containers, same configuration, same Device.
`docs/configuration.md` and `.env.example` carry the variable and say that a
Projects environment sets it in its environment settings rather than a shell
profile.

What is left needs ticket 30: the machine key itself is that ticket's, and this
function takes it as an argument rather than computing a second one beside it.
Nothing calls `deviceKey` yet, because the thing that would call it is the real
Collector, which is ticket 35's.
