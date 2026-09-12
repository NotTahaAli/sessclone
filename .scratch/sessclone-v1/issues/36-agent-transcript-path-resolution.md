# 36: Collector — transcript path resolution

**What to build:** Transcripts are found wherever they actually are, including for a Session whose working directory changed mid-flight and for Agent Runs nested a level deeper.

**Blocked by:** 35.

**Status:** ready-for-agent

- [ ] A Session's transcripts located by searching every project directory for its id
- [ ] Workflow Agent Run transcripts found at their deeper location
- [ ] A Session whose working directory changed is still fully collected
- [ ] Resolution covered by tests using the fixture corpus layout
