# sessclone — v1 design

Date: 2026-09-12
Status: approved for planning

## 1. What this is

sessclone collects Claude Code token usage from every environment a team works
in — laptops, servers, and Claude Code Cloud — into one multi-tenant dashboard
that shows estimated spend per member, per project, and per device, and can
optionally archive raw session transcripts for later analysis.

It is a product from day one: organisations, roles, seats, and tiers, sold as a
hosted service. It is also AGPL-3.0 open source, so anyone may self-host it
instead of paying. There is no free hosted tier; self-hosting is the free tier.

### 1.1 Why estimated, never billed

Claude Code subscription plans do not bill per token, and no per-turn billing
figure is exposed anywhere (verified — see §9). Every money figure in sessclone
is an estimate derived from token counts and a maintained rate table. The
product is spend _awareness_, not accounting.

## 2. v1 scope

In:

- Collector plugin for Claude Code, installed per member, running in every
  environment.
- Ingest API accepting per-turn usage rows.
- Dashboard: spend over time for the org, broken down by member, project, and
  device, with a date range.
- Optional raw session transcript upload and download, opt-in per member.
- Organisations, invites, four roles, manager scopes.
- Tiers, seats, and manual subscription activation.
- Platform admin area: tiers, rates, org activation.

Out of v1, deliberately:

- Automated payment collection (see §8).
- A session-content viewer in the browser. Transcripts are downloadable, not
  browsable.
- Rate-limit and compaction analytics (the `StopFailure` table lands in v1, the
  charts over it do not — see §5.3).
- Any per-tool or per-prompt breakdown.

## 3. Architecture

One Next.js application does everything. Supabase provides Postgres, Auth, and
row-level security. An S3-compatible bucket holds transcripts.

```
sessclone/                       pnpm workspace
├─ apps/web/                     Next.js — dashboard + ingest API
├─ packages/plugin/              Claude Code plugin: hooks + collector
├─ packages/shared/              wire schemas, cost maths, id normalisation
├─ supabase/migrations/          schema, RLS policies, seed data
└─ .claude-plugin/
   └─ marketplace.json           so the plugin installs from this repo
```

Rejected alternatives: ingest on Supabase Edge Functions (adds a Deno runtime
and makes self-hosting require Supabase rather than plain Postgres); a separate
Fastify ingest service (buys scaling that ingest volume does not need). Both
were rejected for the same reason — they cost self-hosters, and self-hosting is
the free tier.

Authorisation lives in RLS policies rather than TypeScript, so the browser
client and the server enforce one model. Ingest writes use the service role
after verifying an API key.

Everything external is env-var driven: `SUPABASE_URL`, the Supabase keys,
`S3_ENDPOINT` / `S3_BUCKET` / credentials, and `SESSCLONE_BASE_URL` in the
plugin. Hosted defaults to Supabase Storage (Oracle Cloud Object Storage is the
operator's alternate); self-hosters point at R2, AWS, or MinIO. No code path
knows which.

## 4. Data model

Tables, with the fields that carry the design (not exhaustive):

- `orgs` — name, `timezone`, `tier_id`, subscription status, retention setting.
- `members` — user, org, role (`owner|admin|manager|member`), nickname.
- `member_scopes` — `(manager_member_id, scoped_member_id)`; which members a
  manager may see.
- `users` — Supabase auth user plus `is_platform_admin`.
- `api_keys` — member, SHA-256 hash, 8-char display prefix, label,
  `last_used_at`, revoked flag.
- `devices` — `(member_id, device_key)` unique, plus editable `nickname`.
- `projects` — org, normalised key, raw remote for debugging.
- `turns` — the core append-only table; one row per model response (§5.1).
- `session_events` — `StopFailure` rows: error type, message, session, time.
- `log_artifacts` — session, storage key, SHA-256, size, uploaded time.
- `tiers` — seat price, included seats, `features jsonb`.
- `rates` — model, unit, price, `effective_from`.
- `org_rate_overrides` — same shape, scoped to one org.

### 4.1 The `turns` table

Identity: `(member_id, session_id, agent_id, message_id)`, unique index,
`agent_id` null for main-session turns.

Dimensions: `org_id`, `member_id`, `device_id`, `project_id`, `occurred_at`
(UTC), `model`, `service_tier`, `speed`, `claude_code_version`,
`remote_session_id` (nullable — the cloud backend's own session handle).

Usage, stored exactly as reported and never pre-aggregated:
`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
`cache_creation_1h_tokens`, `cache_creation_5m_tokens`, `thinking_tokens`,
`web_search_requests`, `web_fetch_requests`.

Money: `reported_cost_usd` nullable, never populated in v1 (§9). Estimated cost
is computed at read time, not stored — so adding a missing rate retroactively
corrects history.

Turns are never deleted by retention. At ~300 bytes a row and ~1k turns per
member per day, a ten-seat org accrues roughly a gigabyte a year, which is not
worth the loss of history.

### 4.2 Identity normalisation

**Project key.** Git remotes are normalised to lowercase `host/owner/repo`,
`.git` stripped, credentials stripped, so `git@github.com:x/y.git` and
`https://github.com/x/y` are one project rather than two. A non-git directory
keys as `local:<hostname>:<absolute path>`, never a bare basename and never a
bare path, so neither two unrelated `api` directories nor the same path on two
machines ever merge (ADR 0005).

**Device key.** `host:<hostname>` for a local machine. In Claude Code Cloud
(`CLAUDE_CODE_REMOTE=true`), `cloud:<CLAUDE_CODE_ACCOUNT_UUID>`, suffixed with
the environment type when it is not `cloud_default`. Container id and hostname
change every run and are not identity. Keyed per member, never globally, so two
members' `MacBook-Pro` stay distinct.

Not collected: `CLAUDE_CODE_USER_EMAIL` and `CLAUDE_CODE_ORGANIZATION_UUID`.
The API key already identifies the member; both are PII no query needs.

## 5. Collection

### 5.1 What the collector sends

Raw signals only: the usage counters above, the model, the ids, the timestamps.
The collector never computes or sends money. Cost is a server-side function of
usage and rates, so a pricing correction fixes every past turn at once.

### 5.2 Dedup

Three sources produce duplicates: a hook that fires twice, a backfill sweep
re-sending delivered rows, and a resumed session re-read from the top. A fourth
is internal to the transcript — assistant entries are written one row per
_content block_, all sharing one `message.id`. Measured on a live transcript:
naive summation overcounts output tokens by 2.4x (48107 vs 19746).

So dedup is not a safety net, it is the correctness mechanism: the unique index
on `(member_id, session_id, agent_id, message_id)` with `ON CONFLICT DO
NOTHING`. Every duplicate source collapses against it, which makes re-sending
free and lets the collector stay stateless about correctness.

> **Corrected by ticket 08's corpus; settled in ADR 0006.** This section said
> the rows of one `message.id` carry byte-identical usage, so the parser could
> take the `apiBlockIndex = 0` row. Both halves are wrong. On opus the earlier
> block holds a _partial_ count written while the response was still streaming:
> `fixtures/transcripts/agent-run-ends-mid-turn.jsonl` has a group reporting 1
> output token at block 0 against 202 at block 1, so taking block 0 undercounts
> that turn by 200x. The rule is the **maximum** of each counter across the
> group — never the first, never the sum. The identity key above is unchanged
> and is what ADR 0006 records; only the block-selection rule is superseded.

### 5.3 Hooks

Five wired, chosen after reviewing all 32 documented events:

- `Stop` — push the turns since the cursor (normally one).
- `SubagentStop` — push the agent run's turns from `agent_transcript_path`
  (the sibling `transcript_path` field points at the _parent_, verified).
- `SessionStart` — sweep: re-send everything for unfinished sessions and drain
  the retry queue. Fires on `startup|resume|clear|compact|fork`, so compaction
  gives extra sweeps mid-session.
- `SessionEnd` — final flush.
- `StopFailure` — record `error_type` (`rate_limit`, `overloaded`,
  `billing_error`, …) into `session_events`. Subscription users cannot be
  billed per token, so "did I hit the limit" is the question they actually
  have, and it costs one small table and no new collection path.

Everything else carries no usage signal, or carries prompt text we decline to
collect. `Notification` quota matchers and `PreCompact`/`PostCompact` are
v1.1 candidates into the same table.

Workflow-tool agents need no third collection path: each fires an ordinary
`SubagentStop` with `agent_type: "workflow-subagent"` and its own
`agent_transcript_path`, verified live. Their transcripts sit one level deeper,
under `subagents/workflows/<run_id>/agent-<id>.jsonl`, so the sweep globs
recursively rather than listing `subagents/` alone.

Nesting is bounded by the environment, not by sessclone. Claude Code Cloud sets
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` and _removes_ the spawn tools from an
agent that has reached it, rather than leaving them to fail — verified from both
a Task-tool subagent and a workflow agent, each reporting no `Agent`, `Task`, or
`Workflow` tool in its toolset or deferred list. Every transcript therefore sits
at most one level below its main session here.

The limit is a setting, so other environments may allow deeper trees. The
collector reads `spawnDepth` from each `agent-<id>.meta.json` and stores it
rather than assuming 1; an agent run is parented by its transcript's location,
which stays correct at any depth. Turn identity is unaffected either way —
`agent_id` is unique regardless of how deep the agent sits.

A transcript's directory is derived from the working directory, and it does not
follow a session whose working directory changes: this session's transcripts
stayed under `projects/-home-user/` while its workflow scripts were written to
`projects/-home-user-sessclone/`. The sweep therefore searches every project
directory for the session's id rather than assuming one home.

### 5.4 Cursor, retries, and the residual gap

A per-session cursor file records the last acknowledged message id and byte
offset, so a `Stop` push is ~300 bytes rather than the whole session. The
cursor is an optimisation only: losing or corrupting it costs bandwidth, never
correctness, because §5.2 absorbs the repeats.

A failed push retries three times in-hook (~100/500/2000 ms), then falls to an
on-disk queue drained by the next `SessionStart` in that environment.

Residual, documented rather than solved: an environment that runs, fails its
final push, and is never revisited loses that tail. Closing it completely would
require server-side polling of the Claude Code Remote API, which needs account
credentials on the server — a trust liability this project will not take on.

### 5.5 Distribution

The plugin ships from this repo via `.claude-plugin/marketplace.json`:
`/plugin marketplace add NotTahaAli/sessclone`, then `/plugin install
sessclone`. Self-hosters use the identical path against their own fork.

Two mechanics, verified by building a probe plugin and installing it here.
Hooks register when `hooks.json` sits at `hooks/hooks.json`, or when
`plugin.json` points at it with a `"hooks"` key — either alone is enough. Only
the remaining combination fails: a bare `hooks.json` in the plugin root with no
pointer is ignored silently, and `claude plugin details <name>` reporting
`Hooks (0)` is how that shows up. (The earlier reading here, that the pointer
was the deciding factor, came from a two-variable test; ticket 02 measured the
four cases one variable at a time.)
Newly installed plugin hooks **do not fire in the session that installed
them**: the probe's `PreToolUse`, `Stop`, and `SubagentStop` never ran despite
registering correctly. Onboarding must therefore end with "restart Claude Code",
and the first post-install `SessionStart` sweep is what backfills the turns that
happened before the restart — not an edge case, the normal first-run path.

## 6. Transcript archival

Opt-in per member, off by default, with a per-project exclusion inside it
(ADR 0005). A project the member has not touched inherits the master switch, so
the per-project setting is an opt-out list; a working directory with no git
remote is keyed by `local:<hostname>:<absolute path>` (§4.2). Enforcement is
server-side at the presign route: it resolves the session to its project from
ingested turns rather than trusting the project the collector claims, which the
collector cannot vouch for itself.

The collector requests a presigned PUT and uploads straight to storage, so the
application never carries the bytes. One object per session at

```
orgs/<org_id>/members/<member_id>/projects/<project_key>/<session_id>.jsonl
```

latest wins — the use case is feeding a whole session to an analysis agent,
which forty partial versions would only obstruct. The key carries member and
project rather than session alone because a session id is not unique: ticket 02
measured two different conversations sharing one, and a flat key would have let
them overwrite each other silently (ADR 0003). The collector sends the SHA-256
with the presign request and the server declines to issue a URL when the stored
hash matches.

Turning archival off is forward-only: new uploads stop, stored artifacts remain
and age out under retention. Deleting them is a separate explicit action a
member takes for their own artifacts, at member or project granularity, which
the project-shaped key makes a prefix sweep.

Retention is org-configurable, default 90 days, capped by the tier. It applies
to artifacts only; disabling transcript storage never touches spend history.

Access: Owner and Admin download any member's artifacts; Manager only those of
members in scope; Member only their own.

## 7. Cost model

Estimated cost is `usage x rate`, resolved by model and effective date, so a
turn keeps the price that was live when it ran.

Prices below are as published on 2026-09-12 and seed the rate table; they are
data, not truth, and the table is what the code reads.

A rate row is `(model, token_class, price_per_mtok, effective_from)` over five
token classes: base input, output, 5-minute cache write, 1-hour cache write,
and cache read. Published multipliers relative to base input are 1.25x for a
5-minute write, 2x for a 1-hour write, and 0.1x for a read — 0.025x on Claude
Fable 5.1 and Mythos 5.1, which is why the read price is a stored column rather
than a computed multiple. Claude Opus 5, the model in this environment: $5
input, $25 output, $6.25 5m write, $10 1h write, $0.50 read, per million
tokens.

Three modifiers then multiply the resolved rate, and every one of them is
already a field on the turn:

- `speed: "fast"` — fast mode on Opus 5 / Opus 4.8 is $10 input and $50 output
  per MTok, double the standard rate. A fast-mode session priced at standard
  rates is understated by half.
- `inference_geo: "us"` — 1.1x across every token class on Claude 4.6 and
  later.
- `service_tier` — the Batch API's 50% discount.

Modifiers are stored per turn and applied at read time, alongside the rate, so
a correction to any of them reprices history.

Server-tool requests are priced separately from tokens, and the two counters
differ: web search is $10 per 1,000 searches, while **web fetch carries no
additional charge** beyond the tokens the fetched content consumes. Both
counters are still stored — `web_fetch_requests` at a zero rate, so the rate
table stays the single place a price change lands.

Cache writes split into 1-hour and 5-minute tokens, verified live: one turn
here wrote 61,008 1-hour tokens and zero 5-minute. Collapsed into one column,
the estimate is wrong by the gap between 2x and 1.25x.

Rates are platform-maintained and effective-dated; an org may override them
when it has negotiated pricing. They are updated by reviewed migration, never
scraped from a pricing page — silent breakage producing wrong money is worse
than stale money.

An unpriced model (a new release, a Bedrock or Vertex id, a null model in an
iteration record) yields `NULL` cost, never `0`. Zero understates the org total
while looking authoritative. The dashboard shows the token totals with a count
of unpriced turns; the platform admin area lists unknown model ids seen, so
adding the rate fills history in retroactively.

## 8. Accounts, roles, and billing

Sign-in is GitHub OAuth plus magic link. No passwords — the only credential
that can be lost is one that exists.

API keys are `sc_live_<32 random bytes, base62>`, stored as a SHA-256 hash plus
an 8-character display prefix, shown in full exactly once. A member may hold
several, each labelled, each revocable, each tracking `last_used_at`. No
expiry: a key that silently stops collecting is worse than one that can be
revoked.

Roles are as defined in `CONTEXT.md`. A Member sees only itself; a Manager sees
only its scope; Admin and Owner see the whole org; billing is Owner-only.
`is_platform_admin` is a flag on the user, not a fifth role — an org owner must
never be able to edit global pricing.

Billing is per-seat within a tier, counting Members only. Tiers gate three
things in v1: included and maximum seats, whether transcript upload is
available at all, and the retention ceiling. Further gates go in `features
jsonb` so the next one is a data change.

Payment collection is deliberately absent. v1 models plans, subscriptions, and
seat limits, and enforces them; a platform admin activates an org by hand after
payment arrives out of band.

The extensibility asked for is carried by the _schema_, not by code: a
subscription row records `provider` (`manual` in v1), `provider_customer_id`,
`provider_subscription_id`, and `provider_metadata jsonb`, all nullable, and
every activation — manual included — writes a row to `subscription_events`.
Adding Stripe, Polar, Paddle, Lemon Squeezy, or JazzCash later is then a new
webhook route writing the same rows, with no migration and no rewrite of
entitlement checks, which read only the subscription's status and tier.

What v1 does not ship is an adapter _interface_ with no implementations behind
it. The shape of that abstraction should be decided by the first real provider,
not guessed before one exists; the schema above is what makes deferring it
free.

## 9. Verified facts

Established by live inspection in this environment, not from documentation:

- Assistant entries in the transcript repeat per content block, sharing one
  `message.id` and `requestId`, with identical `usage`. Deduping by `uuid`
  would overcount 2.4x.
- `message.usage` keys: `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`,
  `output_tokens_details.thinking_tokens`,
  `server_tool_use.{web_search_requests,web_fetch_requests}`,
  `cache_creation.{ephemeral_1h_input_tokens,ephemeral_5m_input_tokens}`,
  `service_tier`, `speed`, `inference_geo`, `iterations[]`.
- Bookkeeping entries (`atis-latch`, `last-prompt`, `queue-operation`, `mode`)
  have no `uuid` and no `timestamp`. The parser must skip them. The set is
  open-ended, so the parser keys on the presence of `message.usage` rather than
  on a list of types to exclude.
- The transcript is append-only: after 58,941 further bytes were written, the
  SHA-256 of the preceding 1,764,969 bytes was unchanged. The cursor's byte
  offset is therefore sound.
- `usage.iterations[]` had exactly one element on all 176 assistant turns
  observed, and its counters equalled the top-level ones. Whether a
  multi-iteration turn sums or restates remains untested — the collector reads
  the top-level counters and ignores `iterations` until that is settled.
- Every turn carries `service_tier`, `speed`, and `inference_geo`, each of
  which changes the price (§7). All 176 turns here were
  `standard`/`standard`/`not_available`, so no modifier path has been exercised
  with a real non-default value.
- Subagent turns live only in `subagents/agent-<id>.jsonl`. Those rows carry
  the _parent's_ `sessionId` plus their own `agentId`, and `isSidechain: true`.
- One `sessionId` per file; the filename stem equals it.
- No cost or price field exists anywhere in the transcript.
- No hook event payload carries token usage, cost, or pricing. Checked against
  the published reference for all 32 events, then confirmed by capturing live
  payloads for `Stop`, `SubagentStart`, `SubagentStop`, `PreToolUse`,
  `PostToolUse`, `PostToolBatch`, `UserPromptSubmit`, `MessageDisplay`,
  `PermissionRequest`, and `Notification`.
- `SubagentStop` provides `agent_transcript_path` separately from
  `transcript_path`, which points at the parent — captured live.
- Workflow-tool agents fire ordinary `SubagentStop` with
  `agent_type: "workflow-subagent"`, and their transcripts live under
  `subagents/workflows/<run_id>/`. A sibling `agent-<id>.meta.json` carries
  `agentType`, `description`, `workflowPhase`, and `spawnDepth`.
- A session's transcript directory is derived from the working directory at
  start and does not move when the working directory changes mid-session.
- Live payloads depart from the published reference in three places, so the
  collector follows the capture, not the docs: `PostToolUse` delivers
  `tool_response` (not `tool_output`) plus `duration_ms`; `PostToolBatch`
  delivers a `tool_calls` array (not `batch_size`); `SubagentStop` carries
  `stop_hook_active`, `background_tasks`, and `session_crons`, and omits the
  documented `stop_reason`.
- Cloud environments expose `CLAUDE_CODE_ACCOUNT_UUID` (stable),
  `CLAUDE_CODE_REMOTE_SESSION_ID`, `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE`;
  `CLAUDE_CODE_CONTAINER_ID` and hostname change per container.

Caveat on the transcript findings: one session, one subagent, one model
(`claude-opus-5`). Behaviour across model switches and compaction boundaries is
untested and should be checked during implementation.

## 10. Aggregation and performance

Charts query the `turns` table directly, indexed on `(org_id, occurred_at)` and
`(member_id, occurred_at)`. No rollup tables in v1: Postgres aggregates a few
million rows in tens of milliseconds, and rollups introduce an invalidation
problem the moment a backfill sweep writes turns into a past day. The ceiling
gets a `ponytail:` marker at the query site naming rollups as the upgrade path.

Timestamps are stored UTC and bucketed at query time in the org's timezone, so
a team reads one chart rather than several disagreeing ones.

## 11. Licensing

AGPL-3.0 for the application, MIT for `packages/plugin`. Nobody may run a
closed fork of the service; the plugin stays trivially embeddable, because
plugin adoption is the distribution channel.

## 12. Known risks

- Business risk is unchanged from the idea note's review: four independent
  open-source attempts at multi-device Claude Code usage aggregation exist and
  none achieved adoption; Anthropic and the ccusage maintainer both declined
  this scope. The response is the team/org shape rather than a solo dashboard,
  which is the one framing the review considered monetisable — but it remains
  unvalidated.
- No payment rail decided, so revenue depends on manual activation until one
  lands.
- Transcript archival is the product's largest liability: transcripts contain
  source code and can contain secrets. Opt-in, per-member, off by default,
  excludable per project, and never enabled org-wide by an admin.
- Archived transcripts are stored **unredacted**, because a scrubbed transcript
  defeats the reason for archiving one. Every control here is access control —
  opt-in, per-project exclusion, RLS on download, the tier gate — and none of it
  is content control, so a storage misconfiguration leaks credentials rather
  than merely metadata. §7's presigned direct-to-storage design means the
  application never holds these bytes, so redaction could only ever run in the
  collector, before upload. No version plans to.
- Rate accuracy is manual. A missed Anthropic price change makes every estimate
  quietly wrong until noticed.

## 13. Toolchain

Verified at design time (`pnpm view`, this environment): next 16.3.5, react
19.3.0, typescript 7.0.2, @supabase/supabase-js 2.116.0, @supabase/ssr 0.12.7,
tailwindcss 4.3.3, zod 4.6.2, recharts 3.10.1, @aws-sdk/client-s3 3.1131.0,
node v22.22.2, pnpm 10.33.0. Re-verify at implementation; never pin from
memory.

Linting is oxlint 1.82.0 with oxlint-tsgolint 7.0.2001, not ESLint. ESLint's
TypeScript support goes through typescript-eslint, which throws
`typescript-eslint does not support TS 7.0` against the pinned compiler
(typescript-eslint#10940). oxlint parses TypeScript itself and reaches type
information through tsgolint, which is built on the same TypeScript 7 native
compiler, so type-aware rules work at the pinned version.
