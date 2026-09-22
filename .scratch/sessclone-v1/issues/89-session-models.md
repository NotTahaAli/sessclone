# 89: What a Session spent, per model

**What to build:** A per-model breakdown on a Session's detail, in dollars and in tokens, asked for by Taha on 2026-09-22.

Ticket 86 gave a Session four tiles, its subagent runs and its Turns, and ticket 88 gave one Turn its quantities. Between those two there is nothing: a Session of four hundred Turns that ran Opus for the hard part and Haiku for the rest shows one total and four hundred rows, and the question "what did the Opus part cost" is answered by reading four hundred rows.

So a section between the tiles and the Turns: one row per model the Session used, naming its Turns, its tokens and its cost in USD, biggest spend first. A Turn that reported no model is its own row rather than dropped — `turns.model` is nullable and `<synthetic>` is a real value no Rate matches, so those Turns belong to the Session's total and the section says where they went.

**Unpriced is not zero.** `turn_costs` prices a Turn with no matching Rate as null and `sum` over nulls is null (ADR 0002), so a model whose every Turn is unpriced shows an em dash and says how many Turns are behind it, and a model with some unpriced Turns says the figure is a floor. A dollar column that quietly summed only the priced half would be the confident wrong number ticket 42 already had to fix once.

The read is the same aggregate the Session summary is, grouped by one more column, so the rows cannot sum to something other than the tile above them.

**Blocked by:** 42, 86, 88.

**Status:** done

- [x] A Session's detail lists its models with Turns, tokens and cost, ranked by cost
- [x] A model with nothing priced reads as unpriced, never as `$0.00`; a partly priced model says how many of its Turns carry no Rate
- [x] Turns that reported no model are a named row, not a silent omission
- [x] The rows sum to the Session's own cost and token tiles, pinned by a test rather than by inspection
- [x] Role scoping is the policies', proven in `sessions.test.ts` as `sessclone_app`
- [x] One statement, index-backed on `turns_identity_key`, alongside the reads the page already makes rather than after them
- [x] Screenshots at 1440x900 and 390x844, light and dark
