# 74 — Spike: Claude Projects session identity and Device handle

Whether a Claude Projects environment can be collected, and what a Collector
running inside one can key a Device on.

Observed from inside a live Projects thread session on 2026-09-20: Claude Code
**2.1.278**, session `2683a83c-0815-5baf-b756-1caae8174c17`, environment
`env_01U4gtc7uiN1ozc7LYtcPShe`, reported by the runtime as environment kind
`anthropic_cloud`. Every claim below is from that container unless it says
otherwise.

## The short version

Projects is not a new source. It is the same CLI writing the same transcripts
in the same place, so the parser, the schema, the ingest contract and ADR 0006
all hold unchanged. One thing is missing and one thing is unanswered:

- **Needed:** a Device keyed on the account rather than the container. Claude
  Code hands one over; ticket 76 uses it.
- **Unanswered:** what happens to a Session when its container is reclaimed.
  See "The open question" — it could not be observed from inside a single
  container's lifetime, and a second container did not settle it either.

## Transcripts

`~/.claude/projects/<sanitised-cwd>/<session-uuid>.jsonl`, exactly the layout
finding 06 recorded for Linux, with the same per-session subdirectory beside
the file that would hold `subagents/agent-<agentId>.jsonl`.

Entries carry `message.usage` in full — `cache_creation_input_tokens`, the
`cache_creation` 5m/1h split, `output_tokens_details.thinking_tokens`,
`server_tool_use`, `service_tier`, `speed`, `inference_geo` and the
`iterations` array — which is every dimension ticket 22 asks for. They also
carry `cwd`, `sessionId`, `version`, `gitBranch`, `isSidechain`, `requestId`
and `message.id`.

**ADR 0006's key holds, and the overcount reproduces.** In the observed
session: 29 usage-bearing assistant entries against 10 distinct `message.id`
values, split by `apiBlockIndex` 0, 1 and 2 — 2.9x. Keying on the per-entry
`uuid` bills three times; keying on `(member, session, agent, message.id)`
bills once. `projects-thread-session.jsonl` in the corpus is the slice that
proves it, and ticket 75's assertions are what fail if it stops being true.

**Projects writes fields the laptop transcripts do not**: `projectsUserTurn`,
`turnOrigin`, `wireIngestContext`, `attributionMcpServer`,
`attributionMcpTool`, `verifiedSlackHumanTurn`, `advisorModel`, `effort`,
`perTurnEffort`, `promptSource`, `origin`. All additive. The redactor's
allowlist replaces each with a placeholder and keeps the key, so the fixture
carries their shape without carrying their contents.

## Hooks

`SessionStart`, `UserPromptSubmit`, `PreToolUse` and `Stop` all fire — observed
directly, both from plugin hooks and from the harness's own. The Collector's
`Stop`-per-turn design therefore works here unmodified.

That also makes `SessionEnd` close to irrelevant, which matters because a
Projects container is reclaimed rather than stopped: finding 05 established
that `SessionEnd` fires ~180ms after SIGTERM, never under SIGKILL, and flushes
nothing. With `Stop` flushing every turn, the exposure is one partial turn —
the same exposure a laptop has, for the same reason.

## Plugins and configuration

Both are per-environment, not per-machine, and both are set from claude.ai
rather than from inside a session: the environment's init script installs
plugins on every container boot, and the environment's settings carry its
variables. Ticket 32's "one setup step per machine" reads as "one setup step
per environment" here, performed in a browser. Nothing about that breaks the
Collector; the install documentation is what has to say it.

## Device identity

Ticket 30 requires a cloud environment to be "keyed by account, not container".
Claude Code supplies the account, and nothing else here is stable:

| Candidate                                | What it actually is                                     |
| ---------------------------------------- | ------------------------------------------------------- |
| `CLAUDE_CODE_ACCOUNT_UUID`               | **The answer.** A UUID, set, and outlives the container |
| `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE`    | Set — `cloud_default` here. The kind, not the instance  |
| `CLAUDE_CODE_ORGANIZATION_UUID`          | Set. Above a Device, not a Device                       |
| `/etc/machine-id`                        | Present, and minted per container                       |
| `HOSTNAME`, `CLAUDE_CODE_ENVIRONMENT_ID` | Empty                                                   |
| `CLAUDE_ENV_ID`, `CLAUDE_SESSION_ID`     | Empty                                                   |
| `CLAUDE_PROJECT_DIR`                     | Empty                                                   |
| `environment_id`                         | Stable, and readable only from inside the session       |

The account UUID is what ticket 30 asked for, in the words it asked for it, and
it costs the Member no setup. Its one cost is granularity: one account with
several environments is one Device. `SESSCLONE_DEVICE` (ticket 76) is the
override for a Member who wants them counted apart — in a Projects environment,
set in the environment settings on claude.ai, because a session cannot set a
variable for the container that replaces it.

`environment_id` is the handle that would key an environment exactly, and it is
reachable only through an in-session MCP tool, not from the separate process a
`Stop` hook runs in. That is why the override is configuration rather than
something the Collector can discover.

**An earlier draft of this note had this wrong**, and said nothing readable was
stable. It checked `CLAUDE_ENV_ID` and `CLAUDE_SESSION_ID`, which are empty,
and not `CLAUDE_CODE_ACCOUNT_UUID`, which is not. The thread working tickets 29
and 30 found the account variable independently; the correction is theirs.

## One conversation, several transcripts

Observed in a second Projects container, by the session coordinating this
project, and it matters more than the reclaim question:

```
<project>/<sessionId>.jsonl                                  329 lines
<project>/<sessionId>/subagents/agent-<agentId>.jsonl         23 lines
```

Every subagent run writes its own transcript one level deeper, carrying the
parent's `sessionId` beside its own `agentId`. So a conversation already maps
to several files without any container reclaim, and **a Collector globbing
`projects/*/*.jsonl` silently drops every one of them** — which is billed
usage, not bookkeeping. Finding 06 recorded the same layout on macOS and
Windows; this confirms it in Projects, and ticket 36 is where it is handled.

Their records interleave in wall-clock time: that subagent's first line
predates its parent's last by about a second. A cursor is therefore per file,
not per Session — anything assuming one monotonic append order across a
Session's files is wrong. Ticket 37 already stores a cursor per transcript;
this is the reason it has to stay that way.

## Two things the existing design already handles

**A Projects session is not one repository.** Its `cwd` starts at `/home/user`,
which is not a repository at all, and moves between repositories mid-session —
the observed session reported three distinct `cwd` values across two repos. A
Project-per-Session model would break on that. sessclone does not have one:
finding 06 already says to read `cwd` off each entry, and ticket 30 keys
Projects on the normalised git remote.

**The cursor does not need to survive.** `SESSCLONE_STATE_DIR` dies with the
container, but so does the transcript it was pointing into, so there is nothing
left to re-report. Ticket 37's guarantee — a lost cursor costs bandwidth, never
data — costs nothing at all here.

## The open question

When a Projects thread continues after its container has been reclaimed, does
the CLI keep the same `sessionId` and append, or start a new transcript for
what the user sees as one conversation?

Two containers have now been looked at — this one and the coordinating
session's — and neither has lived across a reclaim, so both are silent on it.
The coordinating session's transcript spans 27 minutes with a largest gap of
3.6 minutes: continuous, and no evidence either way.

If the answer is the
latter, one conversation becomes several Sessions and a thread's Turns scatter
across them — which ingest can live with (each Session is internally
consistent) but the dashboard cannot present honestly. The question is the same
shape as finding 03's resume-and-fork work and wants the same treatment: a
capture across a real reclaim, not an inference.

Until it is answered, treat a Projects Session as a Session and expect a
conversation to span more than one.
