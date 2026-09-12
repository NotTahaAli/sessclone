# 66: Marketplace manifest and install docs

**What to build:** A Member can install the Collector in two commands and knows what to expect afterwards — including that hooks only take effect after a restart.

**Blocked by:** 33, 39.

**Status:** ready-for-agent

- [ ] Marketplace manifest in this repository, so install needs no second repository
- [ ] Hooks registered through the manifest pointer that actually loads them
- [ ] Documentation states the restart requirement plainly
- [ ] Documentation states that Turns from before the restart are backfilled by the first sweep
- [ ] A self-hoster's fork installs by the same path
