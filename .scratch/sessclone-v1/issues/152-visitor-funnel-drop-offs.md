# 152: Close the visitor-to-sign-up drop-offs

**What to build:** coordinator, 2026-10-01, overnight while Taha slept: walk
sessclone.com as a new visitor at 390px and 1440px (landing, pricing, demo,
docs, sign-up) and fix the clear drop-off points without redesigning.

**What was decided.**

- `/demo` opens Costs on the last 30 days. A demo day is seeded only once it
  has ended, so on the 1st the default calendar month was empty and the first
  screen read "Nothing in this period". The nav's bare `/costs` and Sessions
  still default to the month; making the demo's default period differ would
  change how every range link is written, so it was left.
- The mark atop sign-in and sign-up links to the landing page where the
  deployment has one (`siteLinks().logo`); without one it stays a picture,
  since `/` would only redirect back.
- The landing page closes with the hero's waitlist and demo buttons after the
  FAQ, instead of ending on the footer.
- The docs sidebar links Pricing and Sign up where `/pricing` exists, for
  search visitors landing on the cost guides.
- Left alone, as Taha's earlier calls: the pricing slider's default of 3 (a
  solo visitor slides to 1 for Personal's button) and "Self-host" pointing at
  the repository (its README carries the Deploy button, and stars help).

**Blocked by:** none

**Status:** done

- [x] Demo, sign-in/up mark, landing closing row, docs links
- [x] Full suite against local Postgres; independent review, nits applied
- [x] Screenshots at 1440x900 and 390x844, light and dark
