# 28: API keys

**What to build:** A Member creates a key, sees it exactly once, labels it per machine, and can revoke any one of them without disturbing the others.

**Blocked by:** 27.

**Status:** ready-for-agent

- [ ] Key shown in full once at creation and never again
- [ ] Only a hash and a short prefix are stored
- [ ] Several keys may be active at once, each labelled
- [ ] Revocation takes effect immediately and affects only that key
- [ ] Last-used time displayed, populated by ticket 34
