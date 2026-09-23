# Marketing site design

Ticket 19. Settled 2026-09-20. Uses the tokens and type scale in
`design-system.md`; the prices it presents come from the Tier records in
ticket 24, never from copy written into the page.

## Narrative

The page argues one thing: Claude Code usage is spread across laptops, cloud
sessions and CI, and nobody can see the total.

The headline states it rather than asking it. **"Your team runs Claude Code
in three places. Count it as one."** A question headline ("What is it
costing you?") tested worse against a visitor who can answer "I do not
care" and leave.

Order of the page, at both widths (Direction A, ticket 114, 2026-09-23 —
the dashboard's rows and status card, so the product looks like its own
marketing):

1. **Hero** — headline with "Count it as one." in the accent, one paragraph,
   "Start counting" (the page's one filled button, in the text colour) and
   "Self-host free", the install command with a copy control. Beside it on
   desktop, below it on a phone: a status card of today's collection from an
   example Org, labelled as an example.
2. **How it counts** — three rows: on the machine, on the wire (the
   bytes-per-turn claim), in the ledger.
3. **Pricing rows** — one row per Tier from the table, linking to `/pricing`.
4. **Questions** — led by "Do you read our code?".

The placeholder trust strip, demo, testimonials and product shot were dropped
with the rebuild. Contact is the footer's email.

## Tone and craft

The site is a developer tool and reads like one: plain claims, numbers where
there are numbers, no adjectives doing work a fact could do.

- Geist for everything, Geist Mono for anything a machine produced —
  commands, prices, counts. No serif display face.
- Hairlines and rows, one boxed card per surface at most. No gradient washes,
  no glow, no emoji feature grids.
- The accent appears three times: the headline's second sentence, the live
  glyph, and the logo stroke (plus the "Fits" tag on `/pricing`). Buttons are
  the text colour, never the accent.

**Both themes**, following the visitor's preference (Taha, 2026-09-23). The
earlier dark-only rule is withdrawn.

## Pricing presentation

`/pricing` (ticket 115): a team-size slider, 1 to 25+, landing on 3. The paid
Tier whose seat range holds the size is marked "Fits N people" and shows its
monthly total; the others are dimmed with the reason (1 person only, up to 10
seats, from 11 people). Self-Hosted — the Tier priced 0/0 — is always shown and
never marked. Below, a comparison of every Tier, with the marked column
shaded. The logic is `apps/web/lib/plans.ts`, and everything it prints comes
from the row. The Enterprise per-model rates cell reads "Your own (e.g. an
Anthropic discount)" when the Tier's `features.own_rates` is true (ticket
121), and falls back to the `enterprise` key until that key is written.

The seed, for reference:

| Tier        | Price              | Seats                          |
| ----------- | ------------------ | ------------------------------ |
| Self-Hosted | Free               | No limit                       |
| Personal    | $5 / month         | One person, no seat management |
| Team        | $10 / seat / month | 2 to 10                        |
| Enterprise  | Contact            | 11 and up                      |

A seat is a person, not a machine, and that sentence appears above the
tiers, because "per seat" invites the wrong reading for a tool installed per
device.

The prices above are illustrative of the shape, not a second source of
truth. The page reads the Tier records — seat price, included seats,
retention ceiling — and renders what it finds. Changing a price is an edit
on the platform Tier page (ticket 65), not a deploy.

**Caching.** The read is wrapped in `'use cache'` and tagged with
`cacheTag('tiers')`. Saving a Tier in the admin surface is a Server Action,
so it calls `updateTag('tiers')`, which expires the tag and makes the next
request wait for fresh data rather than serving the old price. A webhook or
route handler cannot call `updateTag`; it uses `revalidateTag('tiers',
'max')` instead. Verified against the Next.js cache-components documentation
on 2026-09-20.

## Self-hosting

Self-hosting is free at any size and is presented as a real tier, not a
footnote, because it is the honest answer to "can we run this ourselves" and
a visitor who finds it buried assumes it is crippled.

Three conditions appear on the card and in the FAQ:

- The sessclone credit stays visible in the panel.
- Features built on top come back as a pull request.
- No closed-source forks.

**Open, and not this document's to settle:** those three sentences are a
licence, and there is no licence yet. AGPL-style copyleft, a source-available
licence, and a custom licence each answer this differently, and none of them
enforces "send it back upstream" the way the sentence reads — copyleft
obliges a distributor to offer source to _their_ users, not to contribute to
this project. Ticket 79 carries it.

## Responsiveness

Reviewed at 390 px and 1440 px. The same content in the same order at both;
the phone stacks to one column, the desktop places the hero copy beside the
product shot and the tiers in a row. Every control clears 44 px. Nothing
requires a horizontal scroll or a zoom to judge.
