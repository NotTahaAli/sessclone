# 66: Marketplace manifest and install docs

**What to build:** A Member can install the Collector in two commands and knows what to expect afterwards — including that hooks only take effect after a restart.

**Blocked by:** 33, 39.

**Status:** done

- [x] Marketplace manifest in this repository, so install needs no second repository
- [x] Hooks registered through the manifest pointer that actually loads them
- [x] Documentation states the restart requirement plainly
- [x] Documentation states that Turns from before the restart are backfilled by the first sweep
- [x] A self-hoster's fork installs by the same path
- [x] An environment with no shell the Member can reach — Claude Code Cloud, Claude Projects — has its own install path written down: the plugin from the environment's init script, the key from its environment settings (finding 74)

## What landed

- `docs/install.md` — the install path: the two commands, the key and URL, the
  restart hooks only take effect after, what the first sweep backfills, how to
  tell a Collector that never arrived from one that was refused, the
  no-shell environments (plugin from the environment's init script with
  `claude plugin marketplace add` / `claude plugin install`, key and URL from
  its settings, one Device per account, state lost on reclaim — finding 74),
  and a self-hoster's fork installing by the same two commands. Linked from
  `README.md` and `docs/configuration.md`.
- `packages/plugin/src/manifest.test.mjs` — the whole chain is walked rather
  than trusted: marketplace entry, the plugin manifest it names, the hooks
  file that manifest points at, the script each of the four events runs, and
  the `packages/shared` modules those scripts import from outside the plugin
  directory (static and lazy alike). Each link is derived from the previous
  one, so repointing `plugin.json` at another existing file fails rather than
  passing. The hook budget is asserted against `SWEEP_BUDGET_MS` rather than a
  fixed 10, which is the invariant that matters. Red-verified by renaming a
  hook script, repointing the manifest, and renaming an imported module.

The doc was corrected after review on three counts worth recording: a key that
has been used with no Turn arriving is **not** evidence of a refusal (ingest
stamps `last_used_at` above the schema check, and a payload with no new Turns
is the common case), the Failures view answers a different question and is
empty precisely when the Collector is not reporting, and an absent
`SESSCLONE_URL` is not a reported problem — it silently defaults to
`http://127.0.0.1:3000`. Only Turns are backfilled by the sweep; a queued
session event is not, and that caveat now sits with the backfill claim rather
than only in the cloud section.

The manifests already existed (ticket 33) and were checked against Claude
Code's own reference rather than left assumed: `.claude-plugin/marketplace.json`
at the repository root is where `/plugin marketplace add <owner>/<repo>` looks,
a `source` starting with `./` resolves against the marketplace root (which is
what makes a fork install by the same path), and a command hook may carry
`args` beside `command`. Read 2026-09-22 from
`code.claude.com/docs/en/plugins-reference`, `/plugin-marketplaces`, `/hooks`
and `claude plugin --help`.
