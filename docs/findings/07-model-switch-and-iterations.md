# 07 — Model switch and multi-iteration turns: findings

Measured in Claude Code 2.1.269 with nested `claude -p` runs in `/tmp/spike-07`,
reading `~/.claude/projects/-tmp-spike-07/<session-id>.jsonl` with `jq`. Three
sessions, one variable changed at a time. Transcripts are kept as fixtures for
ticket 08 (see that directory's `README.md` for the mapping).

## 1. A model switch is per-entry, and only the flag actually switches

`message.model` on each `assistant` entry names the model that produced it.
There is no session-level model declaration anywhere in the file — the first
line is a `queue-operation`, and nothing in the header states a model.

Resuming with a different `--model` changes it mid-file, in the same session id
and the same transcript file:

| Entry                                   | `message.id`            | `message.model`             |
| --------------------------------------- | ----------------------- | --------------------------- |
| 1–2 (turn 1, `--model haiku`)           | `msg_…6vZt8dHQh2N3CDME` | `claude-haiku-4-5-20251001` |
| 3 (turn 2, `--resume … --model sonnet`) | `msg_…kgSQL52jcF2C28rk` | `claude-sonnet-5`           |

Two things follow. The field is fully resolved — an alias (`haiku`, `sonnet`)
never reaches the transcript, only the canonical id, and note the two ids are
not even the same shape (`claude-haiku-4-5-20251001` is dated,
`claude-sonnet-5` is not). And cost must be priced **per entry**, not per
session: one session legitimately holds several models.

A secondary signal exists — an `attachment` entry with `type: "model"` carrying
`attachment.identity.modelId` — but it is emitted when the model is established
or changed, not once per turn (one occurrence in the un-switched session, two in
the switched one). It corroborates; it is not the field to read.

### The negative control: `/model` as a prompt does nothing durable

Sending `/model sonnet` as a `-p` prompt reports success —
`"Set model to `Sonnet 5` for this session only"` — and yet:

- it produces **no `assistant` entry at all** and `modelUsage` is `{}`; it is
  resolved client-side with zero API round trips, so a cost pipeline sees
  nothing;
- the **next** resumed turn is still `claude-haiku-4-5-20251001`.

The slash command mutates in-process state that dies when the `-p` process
exits. `--model` on `--resume` is the only thing that moved `message.model`.
Do not treat a `/model` command in a transcript as evidence of a switch.

## 2. Iterations RESTATE their own usage; they do not accumulate

One prompt forcing a single `Bash` call produced one user turn, two API
iterations, and **four** `assistant` entries carrying only **two** distinct
`message.id` values:

| Entry          | `message.id`            | `input` | `output` | `cache_read` | `cache_creation` |
| -------------- | ----------------------- | ------: | -------: | -----------: | ---------------: |
| 1 (`thinking`) | `msg_…UZhxsaWEmugf7KzB` |      10 |      130 |       28 880 |           24 982 |
| 2 (`tool_use`) | `msg_…UZhxsaWEmugf7KzB` |      10 |      130 |       28 880 |           24 982 |
| 3 (`thinking`) | `msg_…dn6TFSoxxXiLvqvp` |       8 |       46 |       53 862 |              218 |
| 4 (`text`)     | `msg_…dn6TFSoxxXiLvqvp` |       8 |       46 |       53 862 |              218 |

Two independent restatement behaviours, and they must not be confused:

**Within one iteration**, Claude Code splits the content blocks of a single API
response across multiple JSONL lines and copies the _identical_ usage block onto
each. Entries 1 and 2 are one API call written twice. Summing entries doubles
the bill — this is the same shape as the 2.4x overcount recorded in spec §5.2.

> **Corrected by ticket 08.** "Identical" holds for every group measured here,
> but every group here is haiku. Across the wider fixture corpus the blocks of
> one `message.id` are sometimes _not_ identical: the earlier block carries a
> partial count written while the response was still streaming, and only the
> later one carries the whole call. Two groups in `agent-run.jsonl` (opus)
> show it — `output_tokens` of 1 then 202, and 14 then 133 — and in both the
> partial block has **no `iterations` key at all** (nor `speed`, nor
> `server_tool_use`) and `stop_reason: null`, while the complete one has all of
> them. Absent, not empty: a parser branching on `usage.iterations.length`
> throws on it.
>
> So the rule is not "take any entry of the id", which would undercount that
> first turn by 200x, and it is emphatically not the `apiBlockIndex` 0 the v1
> spec used to name — block 0 _is_ the partial write. It is **take the maximum
> of each counter across the entries sharing the id**, which is also correct
> for the identical case and needs no field that may be absent.
>
> One limit on that rule, from the same file: a group whose entries _all_ carry
> `stop_reason: null` is a turn that never finished, and its maximum is a floor
> rather than a total. `agent-run-ends-mid-turn.jsonl` is exactly that — the
> capture ends mid-turn, both blocks report 4 output tokens, and the real total
> is unknown. Ticket 09 has to tell that apart from a complete turn instead of
> billing it. `packages/shared/src/corpus.test.ts` asserts all three shapes
> stay in the corpus.

**Across iterations**, the counters are independent per API call, not
cumulative. The arithmetic is decisive: iteration 2's output is 46, not
130 + 46 = 176; its input is 8, not 18. The CLI's own `modelUsage` roll-up for
the run confirms the parts are meant to be added by the consumer:

| Counter        | iter 1 | iter 2 |    sum | CLI `modelUsage` |
| -------------- | -----: | -----: | -----: | ---------------: |
| input          |     10 |      8 |     18 |           **18** |
| output         |    130 |     46 |    176 |          **176** |
| cache read     | 28 880 | 53 862 | 82 742 |       **82 742** |
| cache creation | 24 982 |    218 | 25 200 |       **25 200** |

**The trap worth naming.** Iteration 2's `cache_read_input_tokens` is 53 862,
which is exactly iteration 1's 28 880 + 24 982. That looks like a running total
and is not: it is the cache written by iteration 1 being read back by iteration 2. Every other counter is plainly non-cumulative. Anyone eyeballing only the
cache column will conclude "restate cumulatively" and subtract a turn's worth
of tokens that were really spent.

So: **sum distinct `message.id`s; never sum entries.**

## 3. The top-level counters are authoritative

Each `message.usage` also carries an `iterations` array of per-API-call
breakdowns. Across all three sessions it was length 1 on every entry, and the
top-level counters equalled the single element exactly — `output_tokens` 130 vs
`iterations[0].output_tokens` 130, and so on for all eleven assistant entries
measured. Nothing had to be reconstructed from parts.

`output_tokens_details.thinking_tokens` (49, 34, 73, 0 in the runs above) is a
_breakdown of_ `output_tokens`, not an addition to it. Adding it double-counts
thinking.

## What the cost pipeline should read

Read, per `assistant` entry:

- `message.id` — the dedup key. One row per distinct id per turn, and where
  several entries share an id, the counters are the **maximum** across them,
  not the first and not the sum (see the correction above).
- `message.model` — the price list to apply, resolved per entry.
- `message.usage.input_tokens`, `.output_tokens`,
  `.cache_read_input_tokens`, `.cache_creation_input_tokens`.

Cost of a Turn = sum over its **distinct** `message.id`s.

Must **not** be read:

- `message.usage.iterations[]` — redundant with the top level, and summing it
  alongside the top level doubles the turn.
- `output_tokens_details.thinking_tokens` — already inside `output_tokens`.
- `attachment.identity.modelId` — not emitted per turn; use `message.model`.
- Any per-entry sum without deduping on `message.id` — exactly 2x here.

## Surprises

- The two model ids have different shapes; a parser that assumes a trailing
  `-YYYYMMDD` date breaks on `claude-sonnet-5`.
- A `/model` slash command is a convincing no-op across a `-p` resume. It says
  it worked, leaves a `<command-name>/model</command-name>` user entry in the
  transcript, and changes nothing the next turn runs on.
- `cache_read_input_tokens` growing by exactly the previous iteration's
  read + creation is a coincidence of how the cache fills, not a running total.
  It is the one number in the block that would mislead a careful reader.

## Not measured

Compaction, `--continue` into a different working directory, and subagent
(`Task`) entries, which write to their own `subagents/` files and may account
usage differently. Ticket 08 should confirm the dedup key holds there.
