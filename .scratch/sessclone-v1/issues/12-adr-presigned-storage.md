# 12: ADR — Presigned direct-to-storage uploads

**What to build:** A recorded decision that transcript bytes never pass through the application.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] States the presign flow and where the hash guard sits
- [x] States that only S3-compatible APIs are used, so any provider can be configured
- [x] States the object naming rule and that the latest upload replaces the prior one
