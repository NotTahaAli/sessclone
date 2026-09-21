# 79: Licence and self-hosting attribution

**What to build:** The licence the project ships under, and the attribution it requires of a self-hosted deployment.

**Blocked by:** none.

**Status:** done

- [x] A LICENSE file at the repo root, chosen deliberately
- [x] The panel credit that a self-hosted deployment must keep, drawn and placed
- [x] Whether the credit is technically removable, and what that means if it is
- [x] Contribution terms written down, since "send features back as a pull request" is not what copyleft obliges
- [x] A CLA or a stated position on not needing one, given a hosted tier is sold alongside

**Why this exists:** the marketing site promises self-hosting free at any size on three conditions — the sessclone credit stays visible in the panel, features built on top come back as a pull request, and no closed-source forks. Those sentences are a licence, and the repo has none. AGPL-style copyleft, a source-available licence and a custom licence answer this differently, and none of them enforces the second condition as written: copyleft obliges a distributor to offer source to their own users, not to contribute upstream. Selling a hosted tier beside it is the part that usually wants a lawyer rather than a default choice.

## Comments

**2026-09-21 — decided and shipped.** AGPL-3.0-only, which the repo already
carried, plus one additional term under section 7(b) requiring the panel
credit. Written out in `NOTICE.md`; the credit itself is `PanelCredit` in
`apps/web/app/panel.tsx`, on every signed-in page.

Removability is answered in `NOTICE.md` and said out loud: the credit is
ordinary markup, nothing checks for it at runtime, and nothing will — deleting
it is a licence breach rather than a technical failure. A licence key or a
tamper check would make a worse promise than the licence already makes.

Contribution terms are `CONTRIBUTING.md`: contributions under AGPL-3.0-only, a
DCO sign-off, and **no CLA**, with the consequence stated — the project cannot
be relicensed without every contributor's agreement, which is a door closed on
purpose because the hosted tier is this same codebase rather than a proprietary
edition of it.

One thing the ticket predicted, confirmed and acted on: "send features back as
a pull request" is not enforceable by any open licence. The marketing copy
(`(marketing)/page.tsx`, `pricing/page.tsx`, `lib/tiers.ts`) now states it as
an ask beside the two conditions the licence really does enforce, rather than
listing three conditions of a kind.

Still outstanding, and outside a ticket: a lawyer's read of an AGPL codebase
with a hosted tier sold beside it. `NOTICE.md` says so rather than implying the
question was settled here.
