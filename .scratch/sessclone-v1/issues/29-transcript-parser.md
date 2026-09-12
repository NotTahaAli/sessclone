# 29: Transcript parser

**What to build:** The function that turns a transcript into Turns — the single place the counting can go wrong, and where the measured overcount is prevented.

**Blocked by:** 01, 08, 09.

**Status:** ready-for-agent

- [ ] One Turn per model response, not per content block
- [ ] Entries without Usage ignored, keyed on absence of Usage rather than a list of types
- [ ] Cache creation kept split; thinking tokens and server-tool counters carried
- [ ] Model and every pricing modifier carried onto the Turn
- [ ] Agent Run transcripts parsed the same way, attributed to their parent Session
- [ ] Runs against the committed fixture corpus, including compaction and model-switch fixtures
