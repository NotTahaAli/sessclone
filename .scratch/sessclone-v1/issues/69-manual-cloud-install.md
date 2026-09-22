# 69: Manual verification — cloud install

**What to build:** Confidence that the cloud path works, including the behaviour that surprised us: hooks not firing in the session that installs them.

**Blocked by:** 66.

**Status:** ready-for-agent

- [x] Fresh install in a cloud environment, with the restart behaviour observed
- [x] Turns from before the restart arrive via the first sweep
- [x] Every container collapses into one Device for that Member
- [ ] A container killed mid-session is checked against what the spike predicted
- [ ] Claude Projects covered as well as Claude Code Cloud, including a Session whose subagent transcripts live one directory deeper, and a Session that moved between repositories mid-flight (finding 74)
