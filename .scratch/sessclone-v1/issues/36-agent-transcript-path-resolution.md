# 36: Collector — transcript path resolution

**What to build:** Transcripts are found wherever they actually are, including for a Session whose working directory changed mid-flight and for Agent Runs nested a level deeper.

**Blocked by:** 35.

**Status:** done

- [x] A Session's transcripts located by searching every project directory for its id
- [x] Workflow Agent Run transcripts found at their deeper location
- [x] A Session whose working directory changed is still fully collected
- [x] Resolution covered by tests using the fixture corpus layout

**How it landed:** Shipped with 35. Every project directory under `<config>/projects` is searched for `<sessionId>.jsonl` and for that id's `subagents/` directory, so a Session whose working directory changed mid-run is collected from both places and a run nested a level deeper is found. The sanitised directory name is never reversed — finding 06 records that it cannot be. The hook's own `transcript_path` is always included, so a non-default config directory still reports the Session even when the search cannot see it. Covered against the corpus layout in `packages/plugin/src/transcripts.test.mjs`.
