# 03 — Resume and fork: findings

What `--resume` and `--resume --fork-session` do to the transcript file, the
session id, and entry ids. Measured in Claude Code 2.1.269, nested `claude -p
--model haiku` runs with `cwd=/tmp/spike-03`, one variable changed per run.

## The runs

A base session was created with an explicit `--session-id`
(`1111…5501`), one turn. Then, separately, it was resumed, and separately
again it was forked. The base file was byte-compared before and after each.

| Run    | Flags                               | File written                            | `sessionId` on every row |
| ------ | ----------------------------------- | --------------------------------------- | ------------------------ |
| base   | `--session-id 1111…5501`            | `1111…5501.jsonl`, 27 rows              | `1111…5501`              |
| resume | `--resume 1111…5501`                | **same file**, 27 → 37 rows             | `1111…5501`              |
| fork   | `--resume 1111…5501 --fork-session` | **new file** `a6d9…e623.jsonl`, 42 rows | `a6d9…e623`              |

After the fork the source file was still 443194 bytes with its original mtime —
forking does not touch the session it forked from.

## Resume appends; nothing is rewritten

The first 27 lines of the post-resume file `diff`ed clean against the
pre-resume copy. The ten new rows continue the `parentUuid` chain from the last
row of the previous turn (`user 6809ab98…` → `parentUuid c9984206…`, the final
attachment of turn 1), carry fresh `uuid`s, and carry a new
`message.id` (`msg_011CeyPcRi…`, against turn 1's `msg_011CeyPaqt…`).

**Resume is invisible to a cursor-based collector.** Same file, same id, strictly
appended, no id reuse. Nothing to do.

## Fork copies the whole history and relabels it

The fork file is the source's 37 rows plus 5 new ones. Every one of the base's
26 `uuid`s reappears in the fork file, and both of the base's `message.id`s
reappear:

```
base uuids: 26   fork uuids: 33   shared: 26
base msgids:  msg_011CeyPaqtSJr3oLCEmjA9TW  msg_011CeyPcRiTDpPfLp2qH3LKf
fork msgids:  msg_011CeyPaqtSJr3oLCEmjA9TW  msg_011CeyPcRiTDpPfLp2qH3LKf  msg_011CeyPkHDSYa8An7N3ajUhB
```

A field-level `jq -S` diff of one copied assistant row against its original
shows exactly one difference:

```
-  "sessionId": "11111111-2222-3333-4444-555555555501"
+  "sessionId": "a6d9bb7b-be60-49b8-9ca5-9d8bdbb6e623"
```

`uuid`, `parentUuid`, `timestamp`, `requestId`, `message.id` and the message
content are all byte-identical. Two forks of the same base were taken; the 26
copied `uuid`s are shared by both fork files as well.

### There is no fork marker

The union of top-level keys across the fork file contains no `forkedFrom`,
`parentSessionId`, or equivalent. The source id does appear once in the fork
file, but only incidentally: a copied `environment` attachment embeds the
original `scratchpadDirectory`, whose path happens to contain the session id.
That is an artifact of how scratchpad paths are named, not a provenance field,
and it must not be relied on.

## What this means for Turn identity

Dedup key is `(member_id, session_id, agent_id, message_id)`.

- **Resume is safe.** Same `session_id`, new `message_id`s, monotonic append.
  A collector pushing from its cursor sees a normal continuation.
- **Fork does not break the key, but it duplicates Turns.** Because the fork
  rewrites `sessionId` on every copied row, `(session_id, message_id)` stays
  unique — no key collision, no overcount under the key. What happens instead is
  that the same conversation content lands as _N_ separate Turns under _N_
  session ids: fork a session three times and turn 1 exists four times, with
  four different `session_id`s and one identical `message_id`.
- **`message_id` is the one field that survives a fork unchanged**, so it is the
  only available join back to the original. Grouping on it would reunite forks —
  and would also be the only way to detect that a fork happened at all.
- **`message_id` is not row-unique even within one session.** A single assistant
  response with a thinking block and a text block is written as two `assistant`
  rows sharing one `message.id` (seen on every assistant turn here). A collector
  that counts rows will double-count; one that keys on `message_id` collapses
  them, which is presumably the intent.

**Ambiguous, stated as such:** whether duplicated-across-forks Turns are _wrong_
is a product question this spike cannot answer. They are genuinely distinct
Sessions that happen to share a prefix. Dedup will not remove them and, given
there is no fork marker, nothing in the transcript says they should be.

## Correction to finding 02, not a contradiction

Finding 02 recorded that a nested `claude -p` reports its parent's `session_id`
and that unsetting `CLAUDE_CODE_SESSION_ID` did not change it. Both hold here.
The missing piece is a second variable: with `CLAUDE_CODE_CHILD_SESSION` also
unset, a fresh `claude -p` minted a random id (`1fb2a6a4-…`) instead of the
parent's. So the inheritance is real and env-driven, and `CLAUDE_CODE_SESSION_ID`
alone is not the whole mechanism.

This mattered for the fork result. The _first_ fork run, with the environment
intact, reported the parent session's id (`456e47f6-…`) — which would have read
as "fork reuses an existing id" had it not been checked. The control above shows
that an ordinary un-forked nested run in a fresh directory gets that same id, so
the first fork run was confounded. The table above is the env-scrubbed run, where
fork mints a fresh random uuid. Un-nested forks were not tested; the collector
should assume fork always yields a session id different from its source, which
held in both runs.

## Transcripts

All six transcripts, unredacted, are handed to ticket 08 at
`scratchpad/spike-transcripts/03/`, laid out by project directory. The
`-tmp-spike-03` directory holds the base, both forks, and a copy of the base as
it stood after the first turn (before the resume appended to it) — that pair is
the byte-level evidence for the append claim.
