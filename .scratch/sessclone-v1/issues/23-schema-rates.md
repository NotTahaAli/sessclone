# 23: Schema — rates and org overrides

**What to build:** The pricing tables, effective-dated, with room for an Org that has negotiated its own.

**Blocked by:** 01, 10, 11.

**Status:** done

- [x] A rate is a model, a token class, a price, and a date it takes effect
- [x] All five token classes representable, including both cache-write tiers
- [x] Server-tool request pricing representable alongside token pricing
- [x] Org overrides in a parallel table with a defined precedence over the platform table
- [x] Policies ship in the same migration

**Answer:** `supabase/migrations/20260920120300_rates.sql` creates `rates` and
`org_rate_overrides` with their policies in the same file. One `rate_class`
enum carries the five token classes and the two server-tool request classes,
so a row cannot claim a class and a contradicting unit; `sessclone_rate_unit`
is where the unit each class is priced in is written down. A null `model`
prices a class for every model, which is what web search is, and a row naming
the model beats it.

`sessclone_resolve_rate(org, model, class, date)` is the precedence, written
once so tickets 41, 42, 63 and 64 do not each invent one: an Org override
beats the platform table, a row naming the model beats a model-independent
one, the latest effective date on or before the day wins, and nothing matching
is `null` rather than `0`. Proven in `apps/web/test/rates.test.ts`, including
that an Owner can neither write the platform list nor write themselves a
discount, and that one Org's override is invisible to another.
