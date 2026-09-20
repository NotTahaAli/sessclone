# Transcript fixtures

Real Claude Code transcripts, redacted, committed so that no parser or cost
test has to invent its own idea of what Claude Code writes. Each one was
captured from a live run by the spike it is named after. Everything up to
`workflow-agent-run.jsonl` came from 2.1.269 on a laptop;
`projects-thread-session.jsonl` came from 2.1.278 inside a Claude Projects
environment, which is why it is the one that carries fields the others do not.

| Fixture                                       | From | What it is the evidence for                                                                 |
| --------------------------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| `resume-appends-to-one-file.jsonl`            | 03   | A resumed Session appends to its existing file and keeps its id                             |
| `fork-repeats-uuids.jsonl`                    | 03   | A fork opens a new file, rewrites `sessionId` on every copied row, and repeats every `uuid` |
| `nested-run-inherits-parent-session-id.jsonl` | 03   | A nested run reporting its parent's id — two conversations, one id                          |
| `compaction.jsonl`                            | 04   | A `compact_boundary` with `parentUuid: null`, and a summary whose `content` is a string     |
| `killed-mid-turn.jsonl`                       | 05   | A session killed mid-turn: the prompt landed, the whole turn did not                        |
| `model-switch.jsonl`                          | 07   | `message.model` changing mid-file within one Session                                        |
| `slash-model-is-not-a-switch.jsonl`           | 07   | The negative control: `/model` writes no assistant entry and switches nothing               |
| `multi-iteration-turn.jsonl`                  | 07   | One user turn, two API iterations, counters independent per iteration                       |
| `agent-run.jsonl`                             | 08   | An Agent Run carrying its parent `sessionId` beside its own `agentId`, ending cleanly       |
| `agent-run-ends-mid-turn.jsonl`               | 08   | The same, but the run died mid-stream — see below, it is the sharpest case in the corpus    |
| `workflow-agent-run.jsonl`                    | 08   | An Agent Run spawned inside a workflow                                                      |
| `projects-thread-session.jsonl`               | 75   | A Claude Projects session: the same format, three usage entries per response                |

## The two cases worth knowing before writing a parser

**`agent-run-ends-mid-turn.jsonl` holds the 200x undercount.** Two entries share
one `message.id` and their Usage blocks are _not_ identical: `apiBlockIndex` 0
reports 1 output token, block 1 reports 202. Block 0 is the partial count
written while the response was still streaming. A parser taking block 0 — which
is what the v1 spec said to do until this corpus disproved it — bills that turn
at 1 token. Take the **maximum** of each counter across the entries sharing the
id. On haiku the blocks do happen to match, which is how the wrong rule survived
being measured once.

**The same file ends mid-turn, on purpose.** Its final group has
`stop_reason: null` on every entry and no `iterations` key at all. The maximum
there is a floor, not a total: the run died before the turn finished. A parser
must tell that apart from a complete turn rather than bill it.

## Redaction

`packages/shared/src/redact.ts` is an **allowlist**: a field survives only by
being named there. Everything else — prose, thinking, tool arguments, tool
output, hook stdout, system prompts, file contents — is replaced, never dropped,
so a field a future Claude Code adds announces itself rather than vanishing.

A replaced **string** becomes `[redacted:<its length>]`. Everything else becomes
a bare `[redacted]` with no length, because a length is the value:
`JSON.stringify(true).length` is 4 and `false` is 5, so a length on a boolean
recovers the boolean.

What survives verbatim: entry and message identity, `cwd`, `gitBranch`, the
queue `operation`, `compactMetadata`, block types, tool ids and names, and the
entire `message.usage` subtree, because cost is computed from it.

Repeatable, one file at a time. Re-running over an already-redacted file is
refused, because a second pass would collapse every length to the length of a
placeholder and nothing downstream would fail:

```bash
node --experimental-strip-types scripts/redact-transcript.mjs <raw>.jsonl \
  packages/shared/fixtures/transcripts/<name>.jsonl
```

Never commit a raw transcript. `packages/shared/src/corpus.test.ts` fails if any
fixture carries a string longer than 64 characters that is not a placeholder,
and it inspects object keys as well as values.

**That guard does not cover `cwd` and `gitBranch`.** Both pass through verbatim
and are almost always under 64 characters. This corpus is clean because it was
captured in a throwaway container — `/tmp/spike-0N`, `gitBranch: HEAD`. A
fixture re-captured on a real machine would commit `/Users/<a real name>/…` and
a real branch name, and nothing would fail. Read those two fields before adding
a fixture.

**The refusal is a substring check, so a session that discusses redaction
cannot be captured.** `projects-thread-session.jsonl` was cut from its source
at the first line containing `[redacted`, which is the line where that session
read `redact.ts` and quoted a placeholder back. Slicing the raw file before
redacting is the workaround; loosening the guard is not, because the failure it
prevents is silent and this one is loud.
