# sessclone

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary, label string equals role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Ticket graph

`docs/tickets/ticket-graph.html` shows every ticket rolled into phases, with
what is done, startable, and still blocked. It is generated, never edited:

```bash
node scripts/ticket-graph.mjs            # rebuild after changing a ticket
node scripts/ticket-graph.mjs --check    # fails when the graph has drifted
git config core.hooksPath .githooks      # once per clone, so commits keep it current
```

Three things keep it honest: a `PostToolUse` hook rebuilds it as tickets are
written here, the pre-commit hook rebuilds and stages it when a commit touches
a ticket, and CI fails a pull request whose graph has drifted. Rendering the
HTML needs the `archify` skill, which lives outside this repo, so CI checks the
committed spec instead.

## Repo rules

### Docs come from Context7, never from memory

Before writing or changing any code that calls a library, framework, or
external API, query Context7 for that library: `resolve-library-id`, then
`query-docs`. This holds in planning, implementation, testing, and debugging
alike. Training data lags; the call is cheap.

Where Context7 has no coverage, read the project's own docs site or repository,
and record what you found in the file that needs it.

### Versions come from the registry

Look up every version before it lands in a file:

```bash
pnpm view <pkg> version          # latest
pnpm view <pkg> deprecated       # undefined means healthy
node -v && pnpm -v               # what this machine actually has
```

Pin exact versions. A version written from recall is wrong often enough to cost
more than the lookup.

### Confirm anything you are not certain of

When you are not certain — an ambiguous requirement, an unfamiliar API shape, a
schema change that could lose data, a rule this file does not cover — ask. A
question costs one message; a confident wrong guess costs a debugging session
and sometimes data.

State assumptions you do proceed on, in the message and in the code.

### Reach for the engineering skills

`mattpocock-skills` covers this repo's workflow. Use them:

- `tdd` — any feature or bugfix
- `diagnosing-bugs` — anything broken, throwing, failing, or slow
- `code-review` — reviewing a branch or a diff
- `domain-modeling` — editing `CONTEXT.md` or writing an ADR
- `codebase-design` — designing a module's interface or moving a seam
- `research` — gathering facts from primary sources
- `prototype` — sanity-checking a design before committing to it
- `grilling` — stress-testing a plan
- `resolving-merge-conflicts` — an in-progress merge or rebase

### Every change clears three bars

**Security.** Validate at trust boundaries with zod — the ingest payload, every
route input, every webhook body. Authorisation lives in RLS policies, so a new
table ships with its policies in the same migration. The service role key runs
only in ingest paths that have already verified an API key, and in the
secret-guarded retention cron that finishes account deletions
(`lib/supabase/admin.ts`), never in anything the browser can reach. Secrets stay in env vars. Transcripts contain source
code and sometimes credentials: treat every log artifact path as sensitive, and
keep transcript upload opt-in per member.

**Speed.** Queries are index-backed, and a query in a loop is a bug — fetch in
one round trip. Paginate anything unbounded. Measure before optimising, and
leave the measurement in the commit message.

**Efficiency.** Bytes go straight to storage through presigned URLs, never
through the application. The collector pushes from its cursor, so a steady-state
turn costs a few hundred bytes rather than a resend of the session. Stream large
files; never accumulate one in memory to hand it on.

Leaks are the failure these three share. Clear every timer and interval,
unsubscribe in every `useEffect` cleanup, abort in-flight fetches with
`AbortController`, and bound any module-level cache — an unbounded `Map` at
module scope grows for the life of the process.

### Look at it before calling it done

Any surface a person will see — a page, a chart, an email, the marketing site —
is verified by running it in Chromium and looking at the screenshots, not by
reading the code that produced it. Drive it with Playwright headless, capture
1440x900 and 390x844, in both light and dark, and inspect what came back.
"It renders" is a claim; a screenshot is evidence.

Keep the shots in the scratch directory, not in the repo. Re-capture a surface
when its markup, styles, or data shape change — not on every commit.

### Test what breaks, once

Each behaviour is covered at exactly one level. A case proven by a unit test is
not re-proven through the browser; the cost of the slow duplicate is paid on
every run, forever.

- **Pure logic** — parsing, identity, cost — unit tests, many, fast.
- **Routes and policies** — against a real Postgres with real migrations.
- **User flows** — Playwright, and only the flows whose failure would be
  serious: sign in, install a Collector and see a Turn arrive, invite someone
  into a full Org, be refused an upload, download an artifact as each Role.

Keep the expensive suites cheap to live with: sign in once and reuse the stored
session rather than logging in per test, seed data through the database rather
than through the UI, and run browser tests on changes to the surfaces they
cover plus once before merge. Full-page snapshot tests are noise — assert the
thing that matters instead.

When a bug escapes, add the one test that would have caught it, at the cheapest
level that would have caught it.

### Delegate, and size the agent to the task

Work that would fill this context with material nobody needs afterwards goes to
a subagent, which returns the conclusion rather than the reading. Independent
pieces run in parallel rather than in sequence.

- **Exploring or searching** — a subagent on a small model at low effort. The
  answer is a list of paths and facts; the file contents do not belong here.
- **Independent build work** — one subagent per concern, in parallel, each
  owning its own files. Concurrent edits to one file are a merge conflict with
  extra steps.
- **Review** — a subagent that did not write the code, on a strong model at
  high effort, told to look for defects rather than to agree. Fresh eyes catch
  what the author's assumptions hide.
- **Mechanical work** — renames, reformatting, moving files — smallest model,
  low effort.
- **Design, architecture, security, and money** — strongest model, high effort.
  These are where a cheap wrong answer costs the most.

The main thread keeps the decisions, the integration, and the conversation with
the user. A subagent that returns a transcript instead of a conclusion was
asked the wrong question.
