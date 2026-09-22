# 0002 — Cost is computed at read time, never stored

**Status:** accepted · 2026-09-12 · ticket 10

## Context

A Turn records Usage: the raw counters Claude Code reported. Cost is money, and
in this product it is always an _estimate_ — subscription plans do not bill per
token, so no figure here is what anyone was charged.

Prices change. They changed while this design was being written. Anything
stored alongside a Turn at write time is a copy of a price that was right once.

## Decision

Cost is derived when it is read. The `turns` table stores Usage and the fields
that modify a price; it stores no money.

**Rate shape.** A rate row is `(model, token_class, price_per_mtok,
effective_from)` over five token classes: base input, output, 5-minute cache
write, 1-hour cache write, and cache read. A Turn resolves against the rate in
force on the date it ran, so history keeps the price that was live at the time.

The five classes are separate columns rather than multipliers off base input,
even though the published relationship is 1.25x / 2x / 0.1x, because the read
multiplier is 0.025x on Claude Fable 5.1 and Mythos 5.1. A multiplier that has
exceptions is a price, and prices belong in the table.

Cache writes stay split into 1-hour and 5-minute. Collapsed into one column the
estimate is wrong by the gap between 2x and 1.25x — and the split is real: one
measured Turn wrote 61,008 1-hour tokens and zero 5-minute.

**Three modifiers** multiply the resolved rate, and each is already a field on
the Turn:

- `speed: "fast"` — double rate on Opus 5 and Opus 4.8. A fast-mode session
  priced at standard rates is understated by half.
- `inference_geo: "us"` — 1.1x across every class on Claude 4.6 and later.
- `service_tier` — the Batch API's 50% discount.

Storing them per Turn and applying them at read time means a correction to any
modifier reprices history the same way a rate correction does.

**Server-tool requests** are priced separately from tokens: web search at $10
per 1,000, web fetch at no additional charge. `web_fetch_requests` is stored
and carries a zero rate rather than being omitted, so the rate table stays the
single place a price change lands if that ever stops being free.

**An unpriced model yields `NULL`, never `0`.** A new release, a Bedrock or
Vertex model id, or a null model in an iteration record has no rate. Zero
understates an Org's total while looking authoritative, which is the worst
failure available to a number about money. The dashboard shows token totals
with a count of unpriced Turns, and the platform admin area lists the unknown
model ids seen.

**Adding a Rate reprices history, and that is the point.** When a rate lands,
every Turn that resolves against it gains a Cost, retroactively and without a
backfill. The same mechanism fixes a wrong price: correct the row, and every
past estimate is correct from the next read.

Rates are platform-maintained, effective-dated, and updated by reviewed
migration or by the platform administrator — never scraped from a pricing page
into the table unreviewed. Ticket 97 reads the published page, but only to
propose: each model's change is shown to the operator and written only once
they approve it. An Org may override them where
it has negotiated pricing. Silent breakage producing wrong money is worse than
stale money.

## Consequences

Every Cost read is a join against rates and overrides. Aggregation carries that
cost on every dashboard query, which is the price of never having a stale
number, and is bounded by the index strategy of design §10 — which rules out
rollup tables in v1, because a backfill sweep writing Turns into a past day
would invalidate them.

Nothing in the product may write a Cost into a Turn as an optimisation. A
cached aggregate is fine; a stored per-Turn Cost is this decision reversed.
