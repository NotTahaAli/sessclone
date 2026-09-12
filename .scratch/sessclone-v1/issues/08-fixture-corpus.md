# 08: Transcript fixture corpus

**What to build:** The committed body of real transcripts every parser and cost test runs against, so no test invents its own idea of what Claude Code writes.

**Blocked by:** 03, 04, 07.

**Status:** ready-for-agent

- [ ] Includes multi-block entries sharing one message id with identical Usage
- [ ] Includes every bookkeeping entry type observed, including those with no id and no timestamp
- [ ] Includes an Agent Run transcript carrying its parent Session id, and a workflow Agent Run transcript, both captured from a live run
- [ ] Includes the resume, fork, compaction, and model-switch transcripts the spikes produced
- [ ] Every fixture redacted of message content, with the redaction documented and repeatable
