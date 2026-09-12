# 22: Schema — turns, devices, projects, session events

**What to build:** The collection tables, including the unique index that makes ingest idempotent.

**Blocked by:** 01, 09, 11, 14.

**Status:** ready-for-agent

- [ ] Turn identity enforced by a unique index, per the identity ADR
- [ ] Usage stored exactly as reported, with cache creation split into its two classes
- [ ] Dimensions carried: model, service tier, speed, inference geography, client version, spawn depth, and the cloud session handle, nullable
- [ ] A nullable reported-cost column that nothing populates yet
- [ ] Indexes supporting org-and-time and member-and-time reads
- [ ] Devices keyed per Member with an editable nickname; projects keyed by normalised remote with the raw remote retained
- [ ] Policies ship in the same migration
