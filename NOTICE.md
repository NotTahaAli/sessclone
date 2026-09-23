# Licence and attribution

SessClone is licensed under the GNU Affero General Public License v3.0 only,
whose unmodified text is in [`LICENSE`](LICENSE), **together with one
additional term under section 7(b) of that licence**: the Appropriate Legal
Notices displayed by the panel, and the sessclone attribution with them, must
be preserved.

That term is stated in full below, and it applies to the whole work except
`packages/plugin`, which is MIT (see [Package licences](#package-licences)).
This file is the notice indicating where to find it, as section 7 requires; it
adds nothing to and removes nothing from the licence text in `LICENSE`, which
is kept verbatim so that tools reading it recognise the AGPL:

> If you add terms to a covered work in accord with this section, you must
> place, in the relevant source files, a statement of the additional terms that
> apply to those files, or a notice indicating where to find the applicable
> terms.

The README's licence section points here too.

## The additional term (AGPL-3.0 section 7(b))

> You must preserve the Appropriate Legal Notices displayed by the panel —
> the copyright notice, the warranty disclaimer, the statement that licensees
> may convey the work under this licence, the link to the licence, and the
> sessclone attribution and its link to the project's repository — in any
> conveyed or network-deployed copy of this software or any work based on it.

The notice being preserved is
[`PanelCredit`](<apps/web/app/(dashboard)/credit.tsx>), on every signed-in page of the panel.
It carries all four things section 0 requires of Appropriate Legal Notices —
copyright notice, no warranty, conveyable under this licence, and how to read
it — plus the author attribution.

That shape is the point rather than decoration. Section 7(b) permits a term
requiring preservation of "specified reasonable legal notices or author
attributions in that material or in the Appropriate Legal Notices displayed by
works containing it", and section 7 makes every non-permissive term that is
**not** one of (a) to (f) a "further restriction" a recipient may simply
remove. A term hung on a marketing line ("open source, self-hostable, free at
any size") would be exactly that: unenforceable, while reading as though it
were not.

The term reaches nothing else. It adds no field-of-use restriction, no naming
requirement on a fork, and no limit on what you charge. It is not severable by
a recipient — a valid 7(b) term is not a further restriction — so a deployment
that drops the notice is in breach rather than in a different licence.

### Is the notice technically removable?

Yes, and deliberately so. It is ordinary markup in a repository you have the
source of. Nothing obfuscates it, phones home about it, or checks for it at
runtime, and nothing will: a licence key or a tamper check would make a promise
the AGPL already makes better, and would make this software worse for the
people running it honestly.

So deleting it is a licence breach rather than a technical failure. That is the
honest shape of it, and it is the shape every attribution requirement in open
source has.

## The three promises, and what each one actually is

The marketing site says self-hosting is free at any size on three conditions.
They are not three of a kind, and the first version of this file got two of
them wrong:

| The promise                                       | What it really is                           |
| ------------------------------------------------- | ------------------------------------------- |
| The panel's notices and credit stay visible       | A licence condition — section 7(b), above   |
| No closed-source forks                            | **Narrower than it sounds** — see below     |
| Features built on top come back as a pull request | **An expectation, not a licence condition** |

**"No closed-source forks"** is not a blanket rule, and the site now says what
it actually is. The AGPL lets you modify this privately and never show anyone.
What it reaches is distribution and remote use: convey a copy and sections 5
and 6 oblige you to offer your recipients the corresponding source; run a
**modified** version as a network service and section 13 obliges you to offer
its remote users the corresponding source. Neither owes anything to the public
or to us. An unmodified deployment owes nothing under section 13 at all.

**"Send features back as a pull request"** is an ask. Copyleft obliges you
toward your own recipients and users, never toward upstream. No open source
licence enforces contributing back, and a custom one that tried would no longer
be open source. So the ask stands as an ask, and the site says so.

## Package licences

| Package                       | Licence       | Why                                                                                                      |
| ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/web`, `packages/shared` | AGPL-3.0-only | The application, and the code it shares                                                                  |
| `packages/plugin`             | MIT           | The Collector installs into someone else's Claude Code, so it must not reach the AGPL into their machine |

## Contributions

Section 7 allows an additional term "for material you add to a covered work, if
authorized by the copyright holders of that material" — so the term above holds
across contributed code only because contributions are offered with it.
[`CONTRIBUTING.md`](CONTRIBUTING.md) states that, along with the Developer
Certificate of Origin sign-off and why there is no Contributor Licence
Agreement.

## Not legal advice

This is the project's stated position, written by its maintainers. A hosted
tier sold beside an AGPL codebase is the part a lawyer should look at before
the first paying customer, and that review has not happened yet.
