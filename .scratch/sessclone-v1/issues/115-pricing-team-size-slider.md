# 115: Pricing page with a team-size slider

**What to build:** Taha, 2026-09-23: "I want pricing page to reflect what each plan gets, how much they pay. Maybe a slider saying Team Size, highlight recommended plan etc. Slider defaults to 3 people and Team Plan."

**Where the ask forks, and what was picked (Taha's picks).**

- Slider 1 to 25+, default 3. The plan that fits is marked and shows its price for that size; the others are dimmed with the reason (1 person only, up to 10 seats, from 11 people). Self-Hosted always shown.
- A comparison table below. Prices and lines read live from the Tier table (ticket 24), never a second source.
- Enterprise line reads "Your own per-model rates (e.g. an Anthropic discount)" (ticket 121).

**Blocked by:** 111.

**Status:** todo

- [ ] Slider and plan rows from `tiers`
- [ ] Comparison table
- [ ] Screenshots
