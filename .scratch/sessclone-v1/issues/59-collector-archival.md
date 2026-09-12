# 59: Collector — archival opt-in and upload

**What to build:** A Member who opts in gets their transcripts archived off the machine, with nothing leaving it until they do.

**Blocked by:** 14, 33, 58.

**Status:** ready-for-agent

- [ ] Off by default; nothing uploads until the Member turns it on
- [ ] Transcript uploaded directly to storage, never through the application
- [ ] An unchanged transcript is not re-uploaded
- [ ] A Session's object is replaced as it grows rather than accumulating versions
- [ ] A refused presign is handled quietly and retried on the next opportunity
