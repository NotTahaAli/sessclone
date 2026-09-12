# 23: Schema — rates and org overrides

**What to build:** The pricing tables, effective-dated, with room for an Org that has negotiated its own.

**Blocked by:** 01, 10, 11.

**Status:** ready-for-agent

- [ ] A rate is a model, a token class, a price, and a date it takes effect
- [ ] All five token classes representable, including both cache-write tiers
- [ ] Server-tool request pricing representable alongside token pricing
- [ ] Org overrides in a parallel table with a defined precedence over the platform table
- [ ] Policies ship in the same migration
