# Licence and attribution

sessclone is **AGPL-3.0-only**. The full text is in [`LICENSE`](LICENSE),
verbatim and unmodified, which the licence itself requires.

This file states the one **additional term** that goes with it, and answers the
questions the marketing site's three self-hosting promises raise.

## The additional term (AGPL-3.0 section 7(b))

> You must preserve the "Powered by sessclone" credit and its link to the
> project's repository, displayed on every signed-in page of the panel, in any
> conveyed or network-deployed copy of this software or any work based on it.

Section 7(b) is the one hook the AGPL offers for attribution — it permits
"requiring preservation of specified reasonable legal notices or author
attributions" — so the credit is a condition of the licence rather than a
courtesy. Anyone redistributing or running this for others keeps it.

The term does not reach anything else: it adds no field of use restriction, no
naming requirement on a fork, and no limit on what you charge. Remove it and
the software is still AGPL-3.0-only.

### Is the credit technically removable?

Yes, and deliberately so. It is
[`PanelCredit`](apps/web/app/panel.tsx) — ordinary markup in a repository you
have the source of. Nothing obfuscates it, phones home about it, or checks for
it at runtime, and nothing will: a licence key or a tamper check would make a
promise the AGPL already makes better, and would make this software worse for
the people running it honestly.

So deleting the line is a licence breach rather than a technical failure. That
is the honest shape of it, and it is the shape every attribution requirement in
open source has.

## The three promises, and what each one actually is

The marketing site says self-hosting is free at any size on three conditions.
They are not three of a kind:

| The promise                                       | What it really is                           |
| ------------------------------------------------- | ------------------------------------------- |
| The sessclone credit stays visible in the panel   | A licence condition — section 7(b) above    |
| No closed-source forks                            | A licence condition — AGPL-3.0 copyleft     |
| Features built on top come back as a pull request | **An expectation, not a licence condition** |

The third one is worth being plain about. Copyleft obliges you to offer _your
users_ the corresponding source of what you run for them (AGPL section 13); it
does not oblige you to open a pull request here. No open source licence
enforces upstreaming, and a custom one that tried would no longer be open
source. So the ask stands as an ask, and the site says so.

## Package licences

| Package                       | Licence       | Why                                                                                                      |
| ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/web`, `packages/shared` | AGPL-3.0-only | The application, and the code it shares                                                                  |
| `packages/plugin`             | MIT           | The Collector installs into someone else's Claude Code, so it must not reach the AGPL into their machine |

## Contributions

[`CONTRIBUTING.md`](CONTRIBUTING.md): Developer Certificate of Origin, no
Contributor Licence Agreement, and why.

## Not legal advice

This is the project's stated position, written by its maintainers. A hosted
tier sold beside an AGPL codebase is the part a lawyer should look at before
the first paying customer, and that review has not happened yet.
