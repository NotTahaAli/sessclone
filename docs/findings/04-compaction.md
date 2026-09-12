# 04 — Compaction artifacts: findings

What a compaction leaves in the transcript, measured on Claude Code 2.1.269 in
this cloud environment, on a real `claude -p` session driven with `--model
haiku`.

## How it was measured

One session in an isolated cwd (`/tmp/spike-04`), one uuid pinned with
`--session-id`, a temporary `--settings` file whose only content was a
`SessionStart` hook piping its stdin payload to a file. Three runs against that
one session id, one variable each:

1. `claude -p 'Say the word banana and nothing else.'` — baseline.
2. `claude -p --resume <id> '/compact'` — the compaction.
3. `claude -p --resume <id> 'Say kiwi and nothing else.'` — one ordinary turn
   after it, to check the file keeps behaving.

The transcript was `cp`-ed and `wc -c`-ed before step 2 and after each step.
The append-only question is answered by hashing the _old prefix_ of the new
file, not by diffing the entry list:

| Stage               | `wc -c` | `sha256sum` of first _pre_ bytes of the file at that stage |
| ------------------- | ------- | ---------------------------------------------------------- |
| after step 1 (pre)  | 436,616 | `10015de6…608375`                                          |
| after step 2 (post) | 660,726 | `10015de6…608375` — identical to the whole pre-file        |
| after step 3        | 880,423 | `6612345f…3ddee6` — identical to the whole post-file       |

`/compact` worked in `-p` mode: the result JSON came back with
`"local_command":"compact"`, and the transcript grew by a `compact_boundary`
entry. No 100k window had to be filled.

## The four answers

### 1. Does `SessionStart` fire with source `compact`?

Yes. The hook fired four times across three runs, and the payloads read, in
order: `startup`, `resume`, **`compact`**, `resume`. The compact payload is its
own shape — it is the only one of the four carrying `prompt_id` and `model`,
and it carries none of the resume-only fields (`seconds_since_last_response`,
`context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd`).

Note the ordering: the `/compact` run fired `SessionStart` **twice** — once as
`resume` when the session was picked back up, then again as `compact` when the
compaction happened. A collector that treats one `SessionStart` per process as
an invariant is wrong.

`session_id`, `transcript_path` and `cwd` are unchanged across all four. A
compaction does not start a new session or a new file.

### 2. Do previously written bytes survive it?

Yes. **The transcript is still strictly append-only across a compaction.** The
436,616 bytes written before `/compact` are byte-for-byte the first 436,616
bytes of the 660,726-byte file after it — same sha256 — and byte 436,615 is a
`\n`, so the old region ends on a clean line boundary with no partial record.
The same held for the ordinary turn that followed.

**A byte cursor stays valid across a compaction.** The collector does not need
to detect compaction to protect the cursor. It does need to survive the size of
what lands: 224,110 bytes appended for one compaction of a nearly-empty
session, one `attachment` entry alone being 167,470 bytes. A pushed delta after
a compaction is not "a few hundred bytes".

### 3. What does it leave behind?

Twenty lines appended, of which three matter:

- `{"type":"system","subtype":"compact_boundary"}` — the marker. Its
  `compactMetadata` is `{"trigger":"manual","preTokens":53991,"durationMs":11574,
"postTokens":24482,"cumulativeDroppedTokens":29509}`. This is the entry to key
  on, and `trigger` is what distinguishes manual from automatic.
- `{"type":"user","isCompactSummary":true}` — the summary itself, a plain
  `message.role:"user"` with a **string** `content` (not a content-block array)
  opening `"This session is being continued from a previous conversation that
ran out of context."`. It also carries `isVisibleInTranscriptOnly:true`.
- the rest is the re-hydrated context: four `user` entries and eight
  `attachment` entries, plus the usual `queue-operation` / `mode` /
  `atis-latch` / `last-prompt` bookkeeping.

The boundary entry has `parentUuid:null` but a `logicalParentUuid` pointing at
the last pre-compaction entry. Anything walking the parent chain to order turns
will see the compaction as a root and start a second tree.

### 4. Does any summary entry carry a Usage block that a naive counter would double-count?

No — and the real hazard is the opposite one.

Searching the whole post-compaction file, exactly two entries carry
`message.usage`, and both are the _pre-compaction_ assistant message. Neither
the `compact_boundary` entry nor the `isCompactSummary` entry has a `usage`
block, or a `message.usage`, at all. The compaction cannot inflate a cost
counter.

What it does instead is **hide** cost. The `/compact` run really spent tokens —
the result JSON reported `inputTokens:1436, outputTokens:977,
cacheReadInputTokens:53856` on `claude-haiku-4-5`, about $0.012 — and **none of
that summarisation call is written to the transcript as a usage-bearing entry**.
A transcript-derived cost figure _undercounts_ by the cost of every compaction.
`compactMetadata.preTokens`/`postTokens` are the only trace, and they are
context sizes, not billed tokens.

Separately, and not caused by compaction: **the same assistant message is
written to the transcript twice.** Lines 22 and 23 share one `message.id`
(`msg_011CeyPc…`), one `requestId`, and one identical usage block, under two
different `uuid`s. The turn after compaction did the same (lines 61/62, one
`msg_011CeyPhU3…`). That is the §5.2 overcount showing up cleanly: dedup on
`message.id`, not on entry `uuid`, or every cost is exactly doubled.

## Unproven

- **Automatic compaction.** Only the manual `/compact` path was exercised, per
  the budget cap. `compactMetadata.trigger` reading `"manual"` strongly implies
  an automatic value exists on the same field, but that the automatic path
  writes the same entry shape, appends rather than rewrites, and fires
  `SessionStart` with the same `compact` source, is inference, not measurement.
  `--autocompact <tokens>` (accepts 100k–1M) is the lever to prove it when a
  session large enough is available cheaply.
- **Whether an automatic compaction can land mid-write**, leaving the collector
  a truncated final line. Not observed here, but never ruled out: the collector
  should still refuse to parse a tail that does not end in `\n`.
- **Repeated compactions in one session.** Only one was run, so it is unproven
  that the second boundary also appends rather than rewriting the first
  summary. `cumulativeDroppedTokens` in `compactMetadata` reads as a
  running total, which suggests boundaries accumulate.

## What ticket 08 gets

Under `spike-transcripts/04/`: `01-pre-compaction.jsonl` (436,616 B),
`02-post-compaction.jsonl` (660,726 B), `03-post-compaction-plus-one-turn.jsonl`
(880,423 B) — one session, three stages, each a prefix of the next — plus the
four raw `SessionStart` hook payloads.
