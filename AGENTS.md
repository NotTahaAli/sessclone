# sessclone

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary, label string equals role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

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
only in ingest paths that have already verified an API key, never in anything
the browser can reach. Secrets stay in env vars. Transcripts contain source
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
