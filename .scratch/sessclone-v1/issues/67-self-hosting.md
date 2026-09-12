# 67: Self-hosting

**What to build:** Someone who would rather not pay can run the whole thing themselves, against their own database and their own bucket.

**Blocked by:** 15, 32, 66.

**Status:** ready-for-agent

- [ ] Every external dependency configured by environment variable, nothing hard-coded
- [ ] A compose file bringing the application up against a supplied database and bucket
- [ ] Storage works against more than one S3-compatible provider, proven with at least two
- [ ] Documentation from clone to first collected Turn
- [ ] Licence obligations stated where a self-hoster will see them
