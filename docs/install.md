# Installing the Collector

The Collector is a Claude Code plugin. Installing it is two commands, two
answers and a restart — and the restart is the step people skip, so it has its
own section below.

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

## Installing it

```
/plugin marketplace add NotTahaAli/sessclone
/plugin install sessclone@sessclone
```

The marketplace manifest lives in this repository
(`.claude-plugin/marketplace.json`), so there is no second repository to add
and nothing to clone. `sessclone@sessclone` is the plugin named `sessclone`
from the marketplace named `sessclone`; the bare `/plugin install sessclone`
works too while no other marketplace you have added offers that name.

Enabling the plugin prompts for two values, and answering them is the whole
setup:

- **Deployment URL** — where this machine reports to, the same address you
  read this dashboard at.
- **API key** — issued in the dashboard under **Keys**, and shown once. It is
  stored as a hash, so nobody, including the deployment, can show it to you
  again.

Claude Code keeps the key in the OS keychain rather than in a file, and hands
both to the hooks on every session afterwards. Nothing to export, nothing to
re-do per shell, and nothing plain-text on disk. To change an answer later,
`/plugin`, disable `sessclone` and enable it again.

This is also the only route that works in the desktop app, which runs Claude
Code with the environment a GUI application is given rather than the one your
`~/.zshrc` builds.

`docs/configuration.md` has the full list of settings, including where the
cursor and the retry queue are kept and how the Device key is derived.

## Without answering the prompt

Both values can come from the environment instead, and an exported one **wins
over the answer given at the prompt** — which is how one terminal is pointed
at a second deployment while the machine's own answers stay as they are:

```bash
export SESSCLONE_API_KEY=sk_your_key_here
export SESSCLONE_URL=https://sessclone.example.com
```

Put them in the profile your shell actually loads (`~/.zshrc`, `~/.bashrc`,
your shell's env file) **and** in the terminal you are in, or open a new one:
editing a profile does not change the shell that is already running, and
restarting Claude Code inside that shell inherits the old environment. Check
with `echo $SESSCLONE_URL` in the terminal you will start Claude Code from.
They go in your shell's environment, not in a file in the repository: the
Collector reads the environment only and never loads a `.env`, so a key
committed to one is a leaked key that does not even work.

**`SESSCLONE_URL` is not checked for being present.** With neither the answer
nor the variable it falls back to `http://127.0.0.1:3000` and the session start
says nothing — so a machine that has only a key reports into its own laptop
forever, which looks exactly like the key-never-used state above.

Claude Code's own settings file takes the same two values, applied to every
session and to the subprocesses a session starts — which is what the hooks
are:

```json
{
  "env": {
    "SESSCLONE_API_KEY": "sk_your_key_here",
    "SESSCLONE_URL": "https://sessclone.example.com"
  }
}
```

That goes in `~/.claude/settings.json` (`%USERPROFILE%\.claude\settings.json`
on Windows). Create it if it is not there; if it is, add the `env` key beside
whatever it already holds. It is strict JSON, so a trailing comma or a `//`
comment is a syntax error and Claude Code reports the file as a Settings Error
at the next start. The key is then in a plain file, which the keychain route
avoids — that is the trade.

Either way, restart Claude Code afterwards: the hooks take effect on the next
start.

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

There is also a command that reads this machine and prints what it found —
the Node version, the resolved state directory, the cursor and queue files as
they actually landed, the Device key, and the transcripts on disk:

```bash
node scripts/verify-collector.mjs
```

Run it from a clone of this repository. An installed plugin is not one: Claude
Code copies `packages/plugin` alone into
`<config dir>/plugins/cache/<marketplace>/<plugin>/<version>/`, and this script
is not in it. It prints a key's first three characters
and its length and never more, so the output is safe to paste to whoever is
helping. `--reconcile --day <date> --tz <zone>` counts a day of Turns off the
transcripts, for checking a dashboard total by hand.

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

## In a Claude Code cloud environment

Claude Code Cloud and Claude Projects have no persistent shell for a Member to
export a variable in, and the container is replaced under you. Both are
configured **per environment, from claude.ai, before a session starts** rather
than from inside one (finding 74). Open the environment for editing at
claude.ai/code.

1. **Setup script.** Paste these two lines. The key on the second line is a
   placeholder and stays exactly as written; step 2 is what puts the real key
   on the wire.

   ```bash
   claude plugin marketplace add NotTahaAli/sessclone
   claude plugin install sessclone --config url=https://sessclone.vercel.app --config api_key=sk_0000000000000000000000000000000000000000000
   ```

2. **API credential.** Under **API credentials**, select **Add credential**
   ([Claude's docs](https://code.claude.com/docs/en/cloud-environments#add-api-credentials)):

   - **Name**: `SessClone`
   - **Credential type**: Bearer
   - **Allowed websites**: `sessclone.vercel.app`
   - **Custom headers**: name `Authorization`, prefix `Bearer`, and your key
     from **Keys** as the value

Anthropic's agent proxy replaces the `Authorization` header on every request to
that host after it leaves the container. The placeholder is what the Collector
sends; the proxy swaps in the real key. So the key never reaches the
container, the session, Claude, or the setup script, which anyone using the
environment can read. The placeholder has the shape of a real key (`sk_` and 43
more, 46 in all) so the session-start check passes; it is not a key and matches
nothing on the deployment.

A self-hosted deployment uses its own `NEXT_PUBLIC_APP_URL` in the command and
its own host in **Allowed websites**.

The Collector reaches the proxy on its own: a hook that finds `HTTPS_PROXY`
set restarts itself with `NODE_USE_ENV_PROXY=1` (`docs/configuration.md`). If
the credential is missing or wrong, the deployment answers 401 and the next
session start prints a line saying the key was refused.

Claude offers API credentials on Pro and Max plans only, not yet on Team or
Enterprise, and not on a self-hosted environment.

Ticket 32's "one setup step per machine" reads as "one setup step per
environment" here, performed in a browser.

### What differs in a cloud environment

- **No Session ever records an end.** Claude Code does not run the
  `SessionEnd` hook when a cloud container is archived, reclaimed or stopped,
  so the dashboard shows a cloud Session's last Turn instead of an end time.
  Nothing is lost by it: the Collector reports at every turn boundary, not at
  session end. The one loss is a turn still in flight when the container is
  killed, which cloud cannot recover because the transcript dies with the
  container (finding 69).
- **Transcripts upload after every turn.** With no `SessionEnd` and no next
  start in the same container, a cloud transcript would never be archived, so
  here the Collector uploads it in the background after each turn (ticket 99).
  The whole file goes each time and replaces the stored copy, which is then at
  most one turn behind. It still needs the archival switch in Settings > You.
- **Every container collapses into one Device.** The Device key is derived from
  the account (`cloud:<account uuid>`), which outlives the container, rather
  than from anything the container mints — so burning through containers does
  not litter the Devices list. The cost is granularity: one account running
  several environments is one Device. Set `SESSCLONE_DEVICE` in the
  environment's variables to count them apart.
- **The state directory is inside the container.** The cursor and the retry
  queue do not survive a reclaim. A report that failed is retried at a later
  turn boundary in the same container; a container reclaimed before then
  takes the retry with it.

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

An install copies **only** `packages/plugin`, with no `node_modules` beside
it. Everything the hooks load at runtime lives inside that directory for that
reason, and `packages/plugin/src/installable.test.mjs` fails on any import
that leaves it — so a module moved out of the plugin, or a dependency added to
one of its hooks, is caught here rather than by a fork that silently collects
nothing.
