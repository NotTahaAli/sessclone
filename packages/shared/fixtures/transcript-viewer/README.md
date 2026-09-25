# Transcript viewer fixtures

Synthetic files for the transcript viewer's parser and timeline (ticket 103).
Unlike `../transcripts/`, which holds real redacted captures, these files were
written by hand. Each one is modelled on real transcripts captured on
2026-09-23: a main session, two Agent runs and a two-agent workflow. Each file
is cut down to the lines a case needs, so a test can say exactly which line
proves what. Tests load them with `loadFixture` or `fixtureText` from
`src/transcript/fixtures.test-helper.ts`.

| Fixture                      | Used by            | The case it covers                                                                  |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `main-session.jsonl`         | `parse.test.ts`    | Every kind of line the parser reads, including one malformed line (see below)       |
|                              | `timeline.test.ts` | Tool call/result pairing, hooks, skill, agent and workflow rows, sections, usage    |
| `agent-done.jsonl`           | `timeline.test.ts` | A finished Agent run: the last message ended its turn, so the run is `done`         |
| `agent-running.jsonl`        | `timeline.test.ts` | A tool call with no result yet, so the run is `running`                             |
| `agent-awaiting-model.jsonl` | `timeline.test.ts` | A tool result the model has not answered yet, so the run is still `running`         |
| `agent-done-no-stop.jsonl`   | `timeline.test.ts` | A run that ends in text with no stop reason, which still counts as `done`           |
| `agent-died.jsonl`           | `timeline.test.ts` | The last message never got a stop reason, so the run died mid-turn                  |
| `agent.meta.json`            | `parse.test.ts`    | The sidecar of a Task agent: type, description, tool use id, depth, shape and model |
| `workflow-agent.meta.json`   | `parse.test.ts`    | The sidecar of a workflow agent, which carries its workflow phase                   |
| `journal.jsonl`              | `parse.test.ts`    | A workflow journal: two agents start, one has a result, so only that one is done    |

## What `main-session.jsonl` holds

26 lines:

- 9 `user` lines and 8 `assistant` lines: prompts, text, thinking (one empty
  block), tool calls and tool results with their `toolUseResult` detail.
- 5 attachments:
  - 2 `hook_success`
  - 1 `hook_non_blocking_error`, which the viewer shows as a failed hook
  - 1 `hook_additional_context`
  - 1 `date`
- 1 `compact_boundary`, 1 `queue-operation` and 1 `ai-title` line.
- 1 malformed line. The parser must keep it as an `unknown` Item, not throw.

`parse.test.ts` checks that every one of these lines becomes at least one Item.
If you add a line, check that test's expected kinds.

## Adding a case

Add the smallest file that shows the behaviour, name it after the case, and
add a row to the table above in the same change.
