# Contributing

## Licence of what you send

Contributions are accepted under **AGPL-3.0-only together with the additional
term in [`NOTICE.md`](NOTICE.md)** — the section 7(b) term that keeps the
panel's legal notices and the sessclone credit visible. Opening a pull request
is an offer of your work under those terms. You keep the copyright in what you
wrote.

Both halves matter. Section 7 permits an additional term "for material you add
to a covered work, if authorized by the copyright holders of that material", so
an inbound licence of bare AGPL-3.0-only would leave the project unable to
apply its own attribution term to contributed code — which is the one term this
project actually depends on.

## Sign your commits off (DCO)

Every commit carries a `Signed-off-by` line:

```bash
git commit -s -m "fix(ingest): stop double-counting a resumed session"
```

That line is the [Developer Certificate of Origin](https://developercertificate.org)
1.1: you are saying you have the right to send this work under this project's
licence. It is one flag on one command, and it is the whole ceremony.

## There is no Contributor Licence Agreement

Deliberately, and it is worth saying why, because a project selling a hosted
tier beside an open codebase is exactly the shape that usually has one.

A CLA buys the maintainer one thing the DCO does not: the right to relicense
your contribution under different terms — typically to ship it in a proprietary
edition. That is the only reason to ask for one here, and this project does not
want it:

- The hosted tier is not a different codebase. It is this repository, run by us
  on our hardware, with the operating work as the thing being sold. A CLA buys
  nothing for a business shaped that way.
- Asking every contributor for a signature to preserve an option nobody intends
  to use costs real contributions.

The consequence, stated plainly: **this project cannot be relicensed without
every contributor's agreement.** Adding a proprietary edition later would mean
asking everyone or rewriting their work. That is a door we are closing on
purpose, not one we forgot about.

If that position ever changes, it changes for future contributions only, in the
open, and with this file's history to show when.

## Before you open a pull request

`AGENTS.md` at the repository root carries the working rules — the issue
tracker under `.scratch/`, the ADRs, and what every change is expected to clear
on security, speed and efficiency. The short version:

```bash
pnpm lint        # oxlint, type-aware
pnpm typecheck   # tsc across every package
pnpm test        # vitest, every suite
pnpm format      # prettier --check
```

The database suites need a local Postgres; `README.md` says how to get one.

## Running it yourself, and sending it back

Self-hosting is free at any size, and you are under no licence obligation to
contribute anything back — see [`NOTICE.md`](NOTICE.md), which is honest about
which of the site's three promises the licence actually enforces.

The ask stands anyway: if you build something on top that other deployments
would want, open a pull request. That is how a project this small stays worth
self-hosting.
