# 28: API keys

**What to build:** A Member creates a key, sees it exactly once, labels it per machine, and can revoke any one of them without disturbing the others.

**Blocked by:** 27.

**Status:** done

- [x] Key shown in full once at creation and never again
- [x] Only a hash and a short prefix are stored
- [x] Several keys may be active at once, each labelled
- [x] Revocation takes effect immediately and affects only that key
- [x] Last-used time displayed, populated by ticket 34
