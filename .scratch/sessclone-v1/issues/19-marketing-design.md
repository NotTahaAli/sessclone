# 19: Marketing site design

**What to build:** The design for the public site: what the product is, who it is for, and what it costs.

**Blocked by:** 16.

**Status:** done

- [x] Landing page narrative, built on the collection-across-environments claim
- [x] Pricing presentation covering per-seat tiers and what each includes
- [x] Self-hosting positioned as the free path, since it is
- [x] Responsive down to a phone, in both themes

**Answer:**

`docs/design/marketing-site.md`. Reviewed as rendered boards at 390 px and
1440 px; Taha chose this direction over the question-led alternative.

The narrative states the claim rather than asking it — "Your team runs Claude
Code in three places. Count it as one." — and runs hero, logos, three questions,
demo, testimonials, FAQ, contact. The demo carries the bytes-per-turn figure,
which is the technical reason to believe the rest. Instrument Serif over IBM Plex
Sans with JetBrains Mono for anything a machine produced; square corners,
hairline rules, clay for interaction only. The site is dark only, as a brand
surface, with one Ivory band at the testimonials; the product carries both
themes.

Four tiers, per seat, with a seat defined as a person rather than a machine:
Self-Hosted free at any size, Personal $5 a month flat, Team $10 a seat a month
for 2 to 10, Enterprise by contact. Those figures illustrate the shape. The page
reads the Tier records from ticket 24 and renders what it finds, so a price
change is an edit on the platform Tier page in ticket 65 rather than a deploy.
The read is wrapped in `'use cache'` with `cacheTag('tiers')`; the admin save is
a Server Action and calls `updateTag('tiers')`, checked against the Next.js
cache-components documentation on 2026-09-20.

Self-hosting is a real tier rather than a footnote, free at any size, on three
conditions: the credit stays in the panel, features come back as a pull request,
and no closed-source forks. Those three sentences are a licence and there is no
licence yet, so ticket 79 owns it rather than this document pretending to settle
it. Ticket 80 owns making the page actually read Tiers.
