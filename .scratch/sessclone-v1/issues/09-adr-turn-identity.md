# 09: ADR — Turn identity and dedup

**What to build:** A recorded decision on what makes a Turn unique, so the schema and the parser cannot disagree about it later.

**Blocked by:** 03, 04, 07.

**Status:** done

- [x] States the identity key and why the per-entry id is not it
- [x] Cites the measured overcount that rules the alternative out
- [x] States how resume, fork, and compaction interact with the key, per the spikes
- [x] States that ingest writes are idempotent by conflict, not by prior lookup

**Answer:** `docs/adr/0006-turn-identity-and-dedup.md`. Identity is
`(member_id, session_id, agent_id, message_id)`, enforced by a unique index and
written `ON CONFLICT DO NOTHING`. The per-entry `uuid` is a content-block id,
not a response id, and keying on it reproduces spec §5.2's 2.4x overcount in
the schema; `uuid` keeps the narrower job of recognising a forked Turn as a
copy. Resume is an ordinary continuation, fork duplicates content without
colliding and is deliberately left undeduplicated for want of a fork marker,
and compaction cannot inflate a count but silently undercounts by the cost of
its own summarisation call. The incomplete-turn rule finding 07 addressed to this
ticket — a group whose entries all carry `stop_reason: null` is a floor, not a
total — is recorded in the ADR and owned by ticket 29, since it governs billing
rather than identity. The nested-`session_id` misgrouping of finding 02 goes to
ticket 36 without a discriminator: the obvious one does not survive
measurement, so the ADR says what to capture instead of guessing a rule.
