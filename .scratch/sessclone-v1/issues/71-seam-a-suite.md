# 71: Parser, identity, and cost test suite

**What to build:** The consolidated suite over the pure logic, run against the whole fixture corpus — the tests that would have caught every counting mistake found so far.

**Blocked by:** 08, 29, 30, 42.

**Status:** ready-for-agent

- [ ] One Turn per model response, proven against the multi-block fixtures
- [ ] Entries without Usage ignored, proven against every bookkeeping type in the corpus
- [ ] Agent Run and workflow fixtures attributed to the right parent Session
- [ ] Both spellings of one git remote normalising to one Project
- [ ] Cost correct per token class, and per pricing modifier
- [ ] An unpriced model yielding no Cost, and a later rate filling it in
- [ ] Compaction and model-switch fixtures parsed without loss or double-count
