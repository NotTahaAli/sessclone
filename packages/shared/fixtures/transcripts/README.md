# Transcript fixtures

Real Claude Code 2.1.269 transcripts, redacted, committed so that no parser or
cost test has to invent its own idea of what Claude Code writes. Each one was
captured from a live run by the spike it is named after.

| Fixture                                       | Captured by | What it is the evidence for                                                                 |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `resume-appends-to-one-file.jsonl`            | 03          | A resumed Session appends to its existing file and keeps its id                             |
| `fork-repeats-uuids.jsonl`                    | 03          | A fork opens a new file, rewrites `sessionId` on every copied row, and repeats every `uuid` |
| `nested-run-inherits-parent-session-id.jsonl` | 03          | A nested run reporting its parent's id — two conversations, one id                          |
| `compaction.jsonl`                            | 04          | A `compact_boundary` with `parentUuid: null`, and a summary whose `content` is a string     |
| `killed-mid-turn.jsonl`                       | 05          | A session killed mid-turn: the prompt landed, the whole turn did not                        |
| `model-switch.jsonl`                          | 07          | `message.model` changing mid-file within one Session                                        |
| `slash-model-is-not-a-switch.jsonl`           | 07          | The negative control: `/model` writes no assistant entry and switches nothing               |
| `multi-iteration-turn.jsonl`                  | 07          | One user turn, two API iterations, counters independent per iteration                       |
| `agent-run.jsonl`                             | 08          | An Agent Run carrying its parent `sessionId` beside its own `agentId`                       |
| `workflow-agent-run.jsonl`                    | 08          | The same, for an Agent Run spawned inside a workflow                                        |

`agent-run.jsonl` also carries the corpus's sharpest case: two entries sharing
one `message.id` whose usage blocks are _not_ identical, because the first was
written while the response was still streaming. Priced off the first entry that
turn costs 1 output token instead of 202. See `docs/findings/07-…` .

## Redaction

`packages/shared/src/redact.ts` is an **allowlist**: a field survives only by
being named there. Everything else — prose, thinking, tool arguments, tool
output, hook stdout, system prompts, file contents — is replaced by
`[redacted:<length of what it replaced>]`. A field a future Claude Code adds is
redacted by default rather than leaking into a commit; the cost is that a new
usage field goes missing until someone names it, which the tests say loudly.

What survives verbatim: entry and message identity, `cwd`, `gitBranch`, the
queue `operation`, `compactMetadata`, block types, tool ids and names, and the
entire `message.usage` subtree, because cost is computed from it.

Repeatable, one file at a time:

```bash
node --experimental-strip-types scripts/redact-transcript.mjs <raw>.jsonl \
  packages/shared/fixtures/transcripts/<name>.jsonl
```

Never commit a raw transcript. `packages/shared/src/corpus.test.ts` fails if any
fixture carries a string longer than 64 characters that is not a placeholder.
