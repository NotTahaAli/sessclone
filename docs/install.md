# Installing the Collector

The Collector is a Claude Code plugin. Installing it is two commands, one
environment variable and a restart — and the restart is the step people skip,
so it has its own section below.

It reports **usage only**: token counts, models, timings, and the Session,
Project and Device they belong to — plus, per Turn, the working directory it
ran in, the git branch, and the git remote normalised into a Project key. Never
a prompt, never a file's contents. Log Artifacts — the raw transcripts, which
do contain both — are a separate upload that is off until a Member turns it
on.

**Node 22.18 or newer** (or 23.6, or any 24) is required, because the hooks
run as `node <file>.mjs` with no build step and import TypeScript directly.
On an older Node the plugin installs, starts cleanly and reports nothing; the
session-start check names the problem.

## On a machine you have a shell on

```
/plugin marketplace add NotTahaAli/sessclone
/plugin install sessclone@sessclone
```

The marketplace manifest lives in this repository
(`.claude-plugin/marketplace.json`), so there is no second repository to add
and nothing to clone. `sessclone@sessclone` is the plugin named `sessclone`
from the marketplace named `sessclone`; the bare `/plugin install sessclone`
works too while no other marketplace you have added offers that name.

Then, in the shell Claude Code runs in:

```bash
export SESSCLONE_API_KEY=sk_your_key_here
export SESSCLONE_URL=https://sessclone.example.com
```

The key is issued in the dashboard under **Keys**, and is shown once — it is
stored as a hash, so nobody, including the deployment, can show it to you
again.

Put both in the profile your shell actually loads (`~/.zshrc`, `~/.bashrc`,
your shell's env file) **and** in the terminal you are in, or open a new one:
editing a profile does not change the shell that is already running, and
restarting Claude Code inside that shell inherits the old environment. Check
with `echo $SESSCLONE_URL` in the terminal you will start Claude Code from.
They go in your shell's environment, not in a file in the repository: the
Collector reads the environment only and never loads a `.env`, so a key
committed to one is a leaked key that does not even work.

**`SESSCLONE_URL` is not checked for being present.** Unset, it falls back to
`http://127.0.0.1:3000` and the session start says nothing — so a Member who
sets only the key gets a clean start and reports into their own laptop
forever, which looks exactly like the key-never-used state below. Setting it
is how that is avoided.

`docs/configuration.md` has the full list, including where the cursor and the
retry queue are kept and how the Device key is derived.

## Restart Claude Code

**Hooks take effect on the next start, not in the session that installed
them.** So the session you install in reports nothing, and that is expected
rather than a broken install.

**No Turn from before the restart is lost.** The first session started after
it sweeps this environment: it drains anything the retry queue is holding, then
re-reads every recent transcript from its cursor and reports the Turns it finds.
Turns from the install session, and from every session before it that Claude
Code still has a transcript for (its own `cleanupPeriodDays` sweep deletes them
after 30 days by default), are backfilled that way. The sweep is time-boxed to
fit inside the session-start hook and works newest-first, so a very large
history is caught up across several sessions rather than all in one.

What is _not_ backfilled is a session **event** — the record that a turn ended
on an API error, or that a session ended cleanly. Those read no transcript, so
the retry queue is their only durability, and it holds at most 500 entries for
at most 14 days. A session that ran before the install is therefore counted in
full and may still be missing its failure or its clean end. Usage is always
counted from the Turns themselves.

## Checking it worked

Start a session, send one turn, and look at **Costs** in the dashboard.

- **Something arrives.** Done. There is nothing else to install on this
  machine.
- **The page still says it is waiting, and the key has never been used.** The
  Collector has not reached the deployment at all: wrong `SESSCLONE_URL`, no
  network route to it, or the restart has not happened yet.
- **The key has been used and no Turn has arrived.** The key is not the
  problem: a Collector reached the deployment with it. The usual causes are
  that no turn has ended since the restart, or that the reports carried no new
  Turns because the cursor is already at the end of every transcript — both
  resolve themselves on the next turn. A genuine refusal is a 400 from
  `/api/ingest`, which is visible in the deployment's own logs and nowhere in
  the dashboard.
- **A misconfiguration is reported in the session itself.** The session-start
  check reads every variable and writes every problem it found at once: a
  missing key, a key that does not start `sk_` and run to 46 characters, a
  `SESSCLONE_URL` that is set but is not an `http` or `https` URL, a Node older
  than 22.18, and a state directory that cannot be resolved. It prints a key's
  first three characters and its length, never more.

The **Failures** view on Costs answers a different question: it lists turns
that ended on a Claude API error — a rate limit, an overload, a billing
problem. It is filled in by the same Collector, so it is empty while the
Collector is not reporting, and is not where a broken install shows up.

Whether a well-formed key is _live_ is not answerable from a machine: a report
with an unknown or revoked key writes nothing and is answered the same way as
one with no key at all, which is deliberate — ingest is not an oracle for which
keys exist. If the key is the suspect, issue a new one.

## In an environment with no shell you can reach

Claude Code Cloud and Claude Projects have no persistent shell for a Member to
export a variable in, and the container is replaced under you. Both are
configured **per environment, from claude.ai, before a session starts** rather
than from inside one (finding 74):

1. **The plugin** goes in the environment's **init script**, which runs on
   every container boot:

   ```bash
   claude plugin marketplace add NotTahaAli/sessclone
   claude plugin install sessclone@sessclone
   ```

2. **The key and the URL** go in the environment's **settings**, as
   `SESSCLONE_API_KEY` and `SESSCLONE_URL`. A variable set inside a session
   dies with the container that set it.

Ticket 32's "one setup step per machine" reads as "one setup step per
environment" here, performed in a browser.

Two behaviours are particular to these environments:

- **Every container collapses into one Device.** The Device key is derived from
  the account (`cloud:<account uuid>`), which outlives the container, rather
  than from anything the container mints — so burning through containers does
  not litter the Devices list. The cost is granularity: one account running
  several environments is one Device. Set `SESSCLONE_DEVICE` in the
  environment's settings to count them apart.
- **The state directory is inside the container.** The cursor and the retry
  queue do not survive a reclaim, so a Turn queued by a failed report in a
  container that is then reclaimed is re-read from its transcript by the next
  sweep — but a queued session-end marker is not. Usage is still counted from
  the Turns themselves.

## A self-hoster's fork

The same two commands, pointed at your own repository:

```
/plugin marketplace add your-org/your-fork
/plugin install sessclone@sessclone
```

**Rename the marketplace in your fork** — `name` in
`.claude-plugin/marketplace.json` — if anyone on your team might also have
this repository's marketplace added. Two marketplaces cannot share a name, and
`sessclone@sessclone` stops being unambiguous the moment they do.

The manifest travels with the fork, and `source` in it is a relative path into
the same clone, so nothing in it names this repository. Your team's
`SESSCLONE_URL` is your deployment's `NEXT_PUBLIC_APP_URL`; no other value
differs, and nothing needs editing inside the vendored plugin — which is the
point of reading the configuration from the environment.

An install that copies **only** the plugin directory does not work: the hooks
import the parser and the identity rules from `packages/shared` by relative
path, and without that directory beside them they report nothing, silently.
Install from a clone or a fork of the whole repository.
