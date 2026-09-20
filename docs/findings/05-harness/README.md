# Spike 05 harness — what to run where this repo cannot

Three questions in ticket 05 need an environment this machine does not have.
The harness is here so that running them is a copy-paste, not a design job.

| Question                                             | Needs                                                 |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Do Claude Code's hooks fire when a _container_ dies? | Claude Code signed in inside a container              |
| Does Claude Code Cloud signal before reclaiming?     | An environment someone can force-reclaim from outside |
| Does an interactive TTY session lose more?           | A human at a terminal                                 |

## The one rule that makes the results trustworthy

**The hook log must leave the environment as it is written.** A local log file
is exactly what a reclaim destroys, and the page-cache measurement in
`../05-killed-process.md` says the last few seconds of it would be gone even if
the filesystem survived. `collector.mjs` is a nine-line HTTP sink to run
_outside_ the environment under test; `settings.json` points every hook at it.

## Signing Claude Code in inside the container

The container needs to make model requests, and a browser login cannot happen
inside a container that is about to be killed. Use a long-lived token.

**Step 1 — mint the token. On your own machine, not in the container.**

```bash
claude setup-token
```

It opens a browser, and prints a one-year OAuth token. It needs a Claude Pro,
Max, Team or Enterprise plan. **This is a credential for your account.** Do not
paste it into a Dockerfile, an image layer, a commit, or this repository — the
run command below takes it from your shell so it never lands on disk.

The token is scoped to model requests only: it cannot establish Remote Control
sessions or fetch claude.ai connectors. That is all this spike needs.

**Step 2 — build the image.** `Dockerfile` in this directory installs Claude
Code and the hook forwarder, and nothing else:

```bash
docker build -t spike05-claude docs/findings/05-harness/
```

**Step 3 — check the auth path without spending a token.** `authMethod` should
read `none` without the variable and `oauth_token` with it:

```bash
docker run --rm spike05-claude claude auth status
```

**Step 4 — run it authenticated.** Keep the token in a shell variable so it
stays out of your history and out of the image:

```bash
read -rs CLAUDE_CODE_OAUTH_TOKEN && export CLAUDE_CODE_OAUTH_TOKEN
docker run -d --name spike05-live   -e CLAUDE_CODE_OAUTH_TOKEN   -e SPIKE05_SINK=http://host.docker.internal:8477   spike05-claude   claude --settings /work/settings.json -p 'Count from 1 to 400, one number per line, nothing else.'
```

Then kill it mid-turn and read the sink's log:

```bash
sleep 2 && docker kill -s KILL spike05-live
```

### Why there is no volume mounted at `~/.claude`

Anthropic's devcontainer guide mounts a named volume there so a sign-in
survives a rebuild, and pairs it with `CLAUDE_CONFIG_DIR` because
`~/.claude.json` sits outside the directory. **Do not copy that here.**
Transcripts live under `~/.claude/projects`, so a volume at `~/.claude` would
carry them past the container's death — and whether the transcript survives is
the question being asked. The token in an environment variable authenticates
without persisting anything, which is exactly what this run wants.

The same trap applies in reverse to the Collector, and it is the one thing this
spike already settled: its state directory _must_ be on a volume, because
`docker rm` takes the writable layer with it.

## Running it

Outside the environment (laptop, or any host the container can reach):

```bash
node docs/findings/05-harness/collector.mjs   # listens on :8477, appends to hooks.log
```

Inside the environment, with `SPIKE05_SINK` set to that host's URL:

```bash
export SPIKE05_SINK=http://<host>:8477
claude --settings docs/findings/05-harness/settings.json -p 'Count from 1 to 400, one number per line, nothing else.'
```

Then kill it the way the question needs — `docker kill` for the container case,
a platform reclaim for the cloud case — and read `hooks.log`.

## What to record

- **Which hooks arrived**, in order, with their `source`/`reason` fields. The
  open question is whether a reclaim produces a `SessionEnd` `reason` other
  than `"other"`; if it does, the Collector gains a branch it cannot have today.
- **The grace period**: milliseconds between the first hook after the kill
  signal and the last thing the sink receives. That number is the entire budget
  for any flush-on-shutdown, and the container run showed it is zero whenever
  the process is mid-write.
- **Whether the transcript is readable afterwards**, from a restarted
  environment on the same volume. That single yes/no decides whether a recovery
  sweep is a real mechanism or a fiction.
- For the interactive case, **how many prior turns survive**. Headless
  multi-turn already showed only the in-flight turn is lost; the question is
  whether a TTY session behaves the same.

## Expectations, so a surprise is visible as one

From what is already measured, a reclaim should look like the busy-writer case:
no `SessionEnd`, nothing after the kill, and a transcript missing the whole
in-flight turn rather than half of it. **A result that disagrees is the
interesting one** — particularly any `SessionEnd` arriving from a SIGKILLed
container, which would mean the platform signals first and the Collector has a
window it does not currently believe in.
