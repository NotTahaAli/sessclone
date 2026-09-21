# 72: Member archival settings

**What to build:** The controls ADR 0005 assumes exist — a Member turns transcript archival on for themselves, and excludes individual Projects from it once it is on. Nothing else in the product may write these.

**Blocked by:** 14, 21, 22, 44.

**Status:** done

- [x] A Member turns their own archival master switch on and off, and it starts off
- [x] A Member excludes and re-includes individual Projects, which are otherwise archived because a new Project inherits the master switch
- [x] Every Project the Member has Sessions in is listed, including `local:` ones, so an exclusion can be made without guessing a key
- [x] No Role can write another Member's settings, proven as SQL against the policies rather than through the UI
- [x] The settings surface says plainly that turning archival off stops new uploads and keeps what is stored
- [x] The surface says what a transcript from a shared environment contains before the Member opts in: in Claude Projects a Session carries the project's own conversation, other members' messages included, which is more than the Member's own work (finding 74)
