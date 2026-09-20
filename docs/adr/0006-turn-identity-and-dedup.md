# 0006 — Turn identity is `(member_id, session_id, agent_id, message_id)`

**Status:** accepted · 2026-09-20 · ticket 09

## Context

A Turn is reported more than once, by design. The Collector pushes from a
cursor that is an optimisation rather than a correctness guarantee (spec §5.4),
`SessionStart` re-reports every Session not known to be complete, and a drained
retry queue resends what may already have landed. Ingest therefore sees the
same Turn repeatedly and must store it once.

Underneath that, the transcript itself repeats. Every spike that read one found
the same shape: a single model response is written as **several rows**, one per
content block, sharing one `message.id`. Finding 03 saw it on every assistant
turn in the file. Finding 04 saw lines 22 and 23 carry one `message.id`, one
`requestId`, and one identical Usage block under two different `uuid`s.
Finding 07 measured what counting those rows costs — entries 1 and 2 are one
API call written twice, and summing entries doubles the bill. Spec §5.2 records
the full figure across a real session: **a 2.4x overcount**.

So the schema needs a key that is stable across re-reports and that collapses
the repeated rows, and it must survive what resume, fork, and compaction do to
a transcript.

## Decision

A Turn is identified by `(member_id, session_id, agent_id, message_id)`, with
`agent_id` null for a main Session. A unique index enforces it. Ingest writes
`ON CONFLICT DO NOTHING`.

### The per-entry `uuid` is not the key

`uuid` is row-unique wherever it appears, which is exactly why it is the wrong
choice: it identifies a **content block**, not a model response. (It does not
always appear. Bookkeeping entries carry no `uuid` and no `timestamp` — 7 of
the 27 rows in `fixtures/transcripts/nested-run-inherits-parent-session-id.jsonl`
— which is why ticket 29's parser keys on the presence of `message.usage`
rather than on a list of types to skip.) Keyed on `uuid`, the repeated rows are distinct Turns and every Usage
figure they carry is counted again — the 2.4x overcount above, written into the
schema rather than prevented by it.

`message.id` is the level the money lives at. One API call, one price, one row.

The corollary is that `message_id` is **not** row-unique inside a session, so
nothing may treat the transcript's rows as the unit. Ticket 29's parser groups
by `message.id` and takes the **maximum** of each counter across the group —
never the first, never the sum. `apiBlockIndex` 0 is specifically wrong: it is
the partial count written mid-stream, and
`fixtures/transcripts/agent-run-ends-mid-turn.jsonl` holds a group where block
0 reports 1 output token against block 1's 202.

Finding 07 hands one more case to this ticket by name, and it is a **billing**
rule rather than an identity one, so it is recorded here and owned by ticket
29: a group whose entries all carry `stop_reason: null` is a Turn that never
finished. Its maximum is a floor, not a total. The same fixture ends on one.
Identity is unaffected — the group has a `message_id` and is one Turn — but it
must be stored as incomplete rather than billed as a whole Turn.

`uuid` keeps one job, and it is not identity: because a fork rewrites
`sessionId` and nothing else, the `uuid` is the join that recognises a forked
Turn as a copy of an original. It is a provenance field, not a key.

### `member_id` and `agent_id` are part of the key, not decoration

`session_id` is not unique on its own. Finding 02 measured a nested `claude -p`
reporting its parent's `session_id` while writing a separate transcript in a
different project directory: two conversations, one id. Session ids are also
caller-suppliable (`--session-id`), so two Members could collide by accident or
on purpose; scoping identity to the Member contains that to one account.

`agent_id` separates an Agent Run's Turns from the parent Session's. An Agent
Run carries its parent's `sessionId` beside its own `agentId`
(`fixtures/transcripts/agent-run.jsonl`), so without it a subagent's Turns
would collide with the Session that spawned it whenever both reused a
`message.id`.

### How resume, fork, and compaction interact with the key

- **Resume** — nothing to do. Finding 03: same file, same `session_id`, fresh
  `message.id`s, strictly appended, no id reuse. A resumed Session is an
  ordinary continuation under this key.
- **Fork** — no collision, but duplicate content. A fork opens a new file and
  rewrites `sessionId` on every copied row while leaving `uuid`, `parentUuid`,
  `timestamp`, `requestId`, and `message.id` byte-identical. `(session_id,
message_id)` therefore stays unique and nothing overcounts _under the key_ —
  but the same conversation prefix lands as N Turns under N session ids. Fork a
  session three times and turn 1 exists four times.

  **That duplication is accepted in v1 and not deduplicated.** There is no fork
  marker anywhere in the transcript; finding 03 checked the union of top-level
  keys and found no `forkedFrom` or equivalent. Forks are genuinely distinct
  Sessions that share a prefix, and nothing in the data says they should be
  merged. Collapsing them would require inferring provenance from repeated
  `uuid`s, which is a product decision this ADR does not have the evidence to
  make. The cost is visible — repeated `uuid`s across session ids — and
  recoverable later, which a silent merge would not be.

- **Compaction** — invisible to the key, and cheaper than it should be.
  Finding 04: neither the `compact_boundary` entry nor the `isCompactSummary`
  entry carries a `usage` block, so a compaction cannot inflate a Turn count.
  It _deflates_ the total instead: the summarisation call really spends tokens
  (1,436 in / 977 out / 53,856 cache read, measured) and none of it is written
  to the transcript as a usage-bearing entry. A transcript-derived Cost
  undercounts by the cost of every compaction, and no identity key can fix
  that. It is a known, stated limit of the estimate.

  Two operational consequences: the boundary entry has `parentUuid: null`, so
  anything ordering Turns by walking the parent chain sees a second root. The
  key does not walk that chain, and nothing else should need to — but where
  ordering across a compaction is wanted, the boundary also carries
  `logicalParentUuid` pointing at the last pre-compaction entry, so the join is
  recoverable rather than lost. And `SessionStart` fires
  twice around a compaction (`resume`, then `compact`), so one `SessionStart`
  per process is not an invariant the Collector may hold.

### Idempotence is by conflict, never by prior lookup

Ingest does not read to decide whether to write. It writes with `ON CONFLICT
DO NOTHING` against the unique index and lets Postgres settle it.

A read-then-write is a race with itself: two Collectors — a `Stop` hook and a
`SessionStart` sweep on the same machine, or two environments draining queues
at once — both read "absent" and both insert. It is also a second round trip
per Turn on the hottest path in the product, which the efficiency bar rules out
independently.

The conflict target is the unique index, so the constraint is the dedup, rather
than a check that happens to agree with one. `turns` is append-only (spec §Data
— ADR 0002 is the neighbouring rule that it stores no money), so the conflict
action is `DO NOTHING` rather than an upsert: a Turn that
already exists is the same Turn, and a re-report must never rewrite stored
Usage. Ingest returns the last accepted `message.id` so the Collector may
advance its cursor.

## Consequences

Re-reporting is free to be generous. A lost cursor, a duplicated queue drain,
and the `SessionStart` backfill that collects Turns from before a plugin
install all cost bandwidth and nothing else, which is what lets the Collector
choose bandwidth over bookkeeping every time it is unsure.

The parser and the schema cannot disagree about what a Turn is, because the
unique index is the statement. A parser change that started emitting one row
per content block would fail against the index rather than silently multiplying
an Org's bill.

**One gap stays open, and it is not identity's to close.** Finding 02's nested
run means two different conversations can present one `session_id`, and spec
§5.3's sweep — which searches every project directory for a Session's id
precisely so a Session that changed working directory is reunited — will merge
them. The key does not overcount them; it **misgroups** them, attributing a
child's Turns to the parent Session. The two cases want opposite handling and
look identical on the filesystem, so this cannot be fixed by keying Session
identity on the project directory without breaking the sweep it exists to
serve.

It belongs to ticket 36, and this ADR deliberately does **not** hand it a
discriminator, because the obvious one does not survive being measured. A
nested run's transcript is self-contained — no `parentUuid` points outside its
file — which suggests that a moved Session's second file would dangle a
`parentUuid` into its first, and so tell the two apart. But every one of the
eleven committed fixtures has zero dangling `parentUuid`s, and several have
more roots than the nested one does (16 in `compaction.jsonl`, 12 in
`resume-appends-to-one-file.jsonl`, against the nested file's 8) because every
bookkeeping row without a `uuid` counts as a root. So neither figure separates
the nested case from an ordinary transcript, and the moved-directory case — the
other half of the comparison — has never been captured at all.

Ticket 36 needs that capture before it needs a rule. Until it has one, a nested
run's Turns are attributed to its parent Session, which overstates that Session
and understates nothing.
