# 73: Log Artifact deletion

**What to build:** A Member destroys transcripts already uploaded, separately from turning archival off. ADR 0005 keeps the two apart deliberately: stopping collection and destroying what is held are different intentions and must not share a click.

**Blocked by:** 12, 14, 24, 58.

**Status:** ready-for-agent

- [ ] A Member deletes their own Log Artifacts, one Session at a time or a whole Project at once
- [ ] The Project sweep uses the object key's prefix rather than a per-object query
- [ ] Deletion removes the stored object and its `log_artifacts` row together; neither may outlive the other
- [ ] No Role deletes another Member's artifacts, Owner included
- [ ] Deleting a Session's artifact leaves that Session's Turns and every Cost untouched
- [ ] A later Session on an unexcluded Project uploads again — deletion is not an opt-out
