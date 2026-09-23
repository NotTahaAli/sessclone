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

Order of the page, at both widths:

1. **Hero** — eyebrow marking it self-hostable, headline, one paragraph, two
   calls to action, the install command with a copy control. On desktop a
   product shot sits beside the copy; on a phone the shot moves below the
   fold and the copy leads.
2. **Trust strip** — customer logos. Placeholders until real ones exist.
3. **Three questions, one page** — who spent it, on what, and why. The third
   names the transcript and immediately says it is opt-in, because that is
   the objection the claim raises.
4. **Demo** — a 90 second muted loop with a real play control, beside the
   three steps a turn takes from the machine to the ledger. The steps carry
   the bytes-per-turn claim, which is the technical reason to believe the
   rest.
5. **Testimonials** — three, each a specific outcome rather than praise.
6. **FAQ** — six questions, led by "Do you read our code?", because that is
   the one a reader is actually holding.
7. **Contact** — email, seats, and what they need. Reachable from the
   Enterprise tier and from the footer.

## Tone and craft

The site is a developer tool and reads like one: plain claims, numbers where
there are numbers, no adjectives doing work a fact could do.

- **Instrument Serif** for display, **IBM Plex Sans** for body, **JetBrains
  Mono** for anything a machine produced — commands, keys, device names,
  prices, counts.
- Square corners, hairline rules, flat fills. No gradient washes, no glow, no
  rounded cards, no emoji.
- Clay is the only accent and it marks interaction and emphasis, never
  decoration.

The marketing site is **dark only**. It is a brand surface, and the warm
terminal reading is the brand. The product, which people live in for hours,
carries both themes.

The testimonial band was drawn inverted to Ivory at first, as the page's one
contrast. It read as a section from a different site rather than as emphasis,
so it is dark like everything else; the page separates its sections with
hairline rules and panel fills instead.

## Pricing presentation

Four tiers in one row on desktop, stacked on a phone, Team marked as the
common choice with a clay border rather than a larger card.

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

- The SessClone credit stays visible in the panel.
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
