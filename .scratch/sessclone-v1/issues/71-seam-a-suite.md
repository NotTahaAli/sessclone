# 71: Parser, identity, and cost test suite

**What to build:** The consolidated suite over the pure logic, run against the whole fixture corpus — the tests that would have caught every counting mistake found so far.

**Blocked by:** 08, 29, 30, 42.

**Status:** done

- [x] One Turn per model response, proven against the multi-block fixtures
- [x] Entries without Usage ignored, proven against every bookkeeping type in the corpus
- [x] Agent Run and workflow fixtures attributed to the right parent Session
- [x] Both spellings of one git remote normalising to one Project
- [x] Cost correct per token class, and per pricing modifier
- [x] An unpriced model yielding no Cost, and a later rate filling it in
- [x] Compaction and model-switch fixtures parsed without loss or double-count
